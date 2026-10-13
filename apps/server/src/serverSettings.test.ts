/* agent-watermark: model=haiku-5.5; effort=high; duration=55m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=35m; seat=codex; date=2026-10-02 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-01 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  ServerSettingsClientPatch,
  ProviderDriverKind,
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import { TestClock } from "effect/testing";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import * as ServerConfig from "./config.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import * as ServerSettingsModule from "./serverSettings.ts";
import { resolveProviderInstanceTerminalEnvironment } from "./terminal/Manager.ts";

const decodeSettingsPatch = Schema.decodeUnknownEffect(ServerSettingsPatch);
const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);
const decodeClientSettingsPatch = Schema.decodeUnknownEffect(ServerSettingsClientPatch);
const decodePersistedSettings = Schema.decodeUnknownEffect(Schema.fromJsonString(ServerSettings));

const makeServerSettingsLayer = () =>
  ServerSettingsModule.layer.pipe(
    Layer.provide(ServerSecretStore.layer),
    Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

const makeFailingSecretStoreLayer = (cause: ServerSecretStore.SecretStoreError) =>
  Layer.succeed(
    ServerSecretStore.ServerSecretStore,
    ServerSecretStore.ServerSecretStore.of({
      get: () => Effect.fail(cause),
      set: () => Effect.void,
      create: () => Effect.void,
      getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
      remove: () => Effect.void,
    }),
  );

const recordProviderUsage = (provider: string, instanceId: string | null = provider) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_thread_sessions (
        thread_id,
        status,
        provider_name,
        provider_instance_id,
        updated_at
      )
      VALUES (
        ${`thread-${instanceId ?? provider}`},
        ${"ready"},
        ${provider},
        ${instanceId},
        ${"2026-08-25T00:00:00.000Z"}
      )
    `;
  });

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("preserves context when reading a provider environment secret fails", () => {
    const platformCause = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readFile",
      pathOrDescriptor: "provider environment secret",
      description: "Secret backend unavailable.",
    });
    const cause = new ServerSecretStore.SecretStoreReadError({
      resource: "provider environment secret",
      cause: platformCause,
    });
    const configLayer = Layer.fresh(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-server-settings-secret-failure-test-",
      }),
    );
    const settingsLayer = ServerSettingsModule.layer.pipe(
      Layer.provide(makeFailingSecretStoreLayer(cause)),
      Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
      Layer.provideMerge(configLayer),
    );

    return Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"codex_personal":{"driver":"codex","environment":[{"name":"OPENROUTER_API_KEY","value":"","sensitive":true,"valueRedacted":true}],"config":{}}}}',
      );

      const error = yield* Effect.flip(serverSettings.getSettings);

      assert.deepInclude(error, {
        _tag: "ServerSettingsError",
        operation: "read-secret",
        providerInstanceId: "codex_personal",
        environmentVariable: "OPENROUTER_API_KEY",
      });
      assert.strictEqual(error.cause, cause);
      assert.notInclude(error.message, cause.message);
    }).pipe(Effect.provide(settingsLayer));
  });

  it.effect("identifies provider history query failures", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DROP TABLE projection_thread_sessions`;

      const error = yield* Effect.flip(serverSettings.getSettings);

      assert.deepInclude(error, {
        _tag: "ServerSettingsError",
        operation: "read-provider-history",
        settingsPath: serverConfig.settingsPath,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("decodes nested settings patches", () =>
    Effect.gen(function* () {
      assert.deepEqual(
        yield* decodeSettingsPatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }),
        {
          providers: { codex: { binaryPath: "/tmp/codex" } },
        },
      );

      assert.deepEqual(
        yield* decodeSettingsPatch({
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        }),
        {
          textGenerationModelSelection: {
            options: [{ id: "fastMode", value: false }],
          },
        },
      );
    }),
  );

  it.effect(
    "decodes legacy object-shaped textGenerationModelSelection.options from settings.json",
    () =>
      Effect.gen(function* () {
        const decoded = yield* decodeServerSettings({
          textGenerationModelSelection: {
            provider: ProviderDriverKind.make("codex"),
            model: "gpt-5.4-mini",
            options: { reasoningEffort: "low" },
          },
        });

        assert.deepEqual(decoded.textGenerationModelSelection, {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4-mini",
          options: [{ id: "reasoningEffort", value: "low" }],
        });
      }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
          },
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            customModels: ["claude-custom"],
          },
        },
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: createModelSelection(
            ProviderInstanceId.make("codex"),
            DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
            [
              { id: "reasoningEffort", value: "high" },
              { id: "fastMode", value: true },
            ],
          ).options!,
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: [{ id: "fastMode", value: false }],
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        shadowHomePath: "",
        launchArgs: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        homePath: "",
        customModels: ["claude-custom"],
        launchArgs: "",
        autoCompactWindow: "",
      });
      assert.deepEqual(
        next.textGenerationModelSelection,
        createModelSelection(
          ProviderInstanceId.make("codex"),
          DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          [
            { id: "reasoningEffort", value: "high" },
            { id: "fastMode", value: false },
          ],
        ),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("buffers changes after a subscription is acquired but before it is consumed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const changes = yield* serverSettings.subscribeChanges;

        yield* serverSettings.updateSettings({
          providers: {
            codex: {
              binaryPath: "/usr/local/bin/codex-next",
            },
          },
        });

        const firstChange = yield* changes.pipe(Stream.runHead, Effect.timeout("1 second"));
        assert.equal(
          Option.getOrUndefined(firstChange)?.providers.codex.binaryPath,
          "/usr/local/bin/codex-next",
        );
      }),
    ).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists custom usage prices and removes them from the settings file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const prices = {
          inputCostPerMillionTokens: 2,
          outputCostPerMillionTokens: 8,
          cacheReadCostPerMillionTokens: 0,
        };
        const readPersisted = fileSystem
          .readFileString(serverConfig.settingsPath)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ServerSettings))));

        yield* serverSettings.updateSettings({ usagePriceOverrides: { "example-model": prices } });
        const persisted = yield* readPersisted;
        assert.deepStrictEqual(persisted.usagePriceOverrides, { "example-model": prices });

        yield* serverSettings.updateSettings({ usagePriceOverrides: { "example-model": null } });
        const restored = yield* readPersisted;
        assert.deepStrictEqual(restored.usagePriceOverrides, {});
      }),
    ).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists and broadcasts thread settlement settings", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const changes = yield* serverSettings.subscribeChanges;

        const next = yield* serverSettings.updateSettings({
          sidebarAutoSettleAfterDays: null,
          sidebarAutoSettleOnMerge: false,
        });
        const change = Option.getOrUndefined(yield* Stream.runHead(changes));
        const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
        // Inspect raw persisted JSON before schema decoding can apply defaults.
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        const persisted = JSON.parse(raw) as Record<string, unknown>;

        assert.strictEqual(next.sidebarAutoSettleAfterDays, null);
        assert.isFalse(next.sidebarAutoSettleOnMerge);
        assert.strictEqual(change?.sidebarAutoSettleAfterDays, null);
        assert.isFalse(change?.sidebarAutoSettleOnMerge);
        assert.strictEqual(persisted.sidebarAutoSettleAfterDays, null);
        assert.isFalse(persisted.sidebarAutoSettleOnMerge);
      }),
    ).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-sonnet-4-6",
          options: createModelSelection(
            ProviderInstanceId.make("claudeAgent"),
            "claude-sonnet-4-6",
            [{ id: "effort", value: "high" }],
          ).options!,
        },
      });

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
          options: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
            { id: "reasoningEffort", value: "high" },
          ]).options!,
        },
      });

      assert.deepEqual(
        next.textGenerationModelSelection,
        createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
          { id: "reasoningEffort", value: "high" },
        ]),
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves custom provider instance text generation selections", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [ProviderInstanceId.make("claude_openrouter")]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: true,
            config: { customModels: ["openai/gpt-5.5"] },
          },
        },
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("claude_openrouter"),
          model: "openai/gpt-5.5",
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: ProviderInstanceId.make("claude_openrouter"),
        model: "openai/gpt-5.5",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "uses explicit provider instance enabled state over legacy provider enabled state",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const instanceId = ProviderInstanceId.make("claude_openrouter");

        const next = yield* serverSettings.updateSettings({
          providers: {
            claudeAgent: {
              enabled: false,
            },
          },
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              enabled: true,
              config: { customModels: ["openai/gpt-5.5"] },
            },
          },
          textGenerationModelSelection: {
            instanceId,
            model: "openai/gpt-5.5",
          },
        });

        assert.deepEqual(next.textGenerationModelSelection, {
          instanceId,
          model: "openai/gpt-5.5",
        });
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves enabled text generation selections for non-built-in drivers", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const instanceId = ProviderInstanceId.make("openrouter_text");

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("openrouter"),
            enabled: true,
            config: { customModels: ["openai/gpt-5.5"] },
          },
        },
        textGenerationModelSelection: {
          instanceId,
          model: "openai/gpt-5.5",
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId,
        model: "openai/gpt-5.5",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "preserves the source control writer selection when its provider instance is disabled",
    () =>
      Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const instanceId = ProviderInstanceId.make("codex_writer");
        const sourceControlWriterModelSelection = {
          instanceId,
          model: "gpt-5.4-mini",
        };

        yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              config: {},
            },
          },
          sourceControlWriterModelSelection,
        });

        const next = yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: false,
              config: {},
            },
          },
        });

        assert.deepEqual(next.sourceControlWriterModelSelection, sourceControlWriterModelSelection);
        assert.deepEqual(
          ServerSettingsModule.resolveSourceControlWriterModelSelection(next),
          next.textGenerationModelSelection,
        );
        assert.deepEqual(
          (yield* serverSettings.getSettings).sourceControlWriterModelSelection,
          sourceControlWriterModelSelection,
        );

        const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
        assert.deepEqual(
          // @effect-diagnostics-next-line preferSchemaOverJson:off
          JSON.parse(raw).sourceControlWriterModelSelection,
          sourceControlWriterModelSelection,
        );

        const restored = yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              enabled: true,
              config: {},
            },
          },
        });
        assert.deepEqual(
          ServerSettingsModule.resolveSourceControlWriterModelSelection(restored),
          sourceControlWriterModelSelection,
        );
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("drops stale text generation options when resetting model selection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: createModelSelection(
            ProviderInstanceId.make("codex"),
            DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
            [
              { id: "reasoningEffort", value: "high" },
              { id: "fastMode", value: true },
            ],
          ).options!,
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        instanceId: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId,
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("replaces provider instance maps when clearing optional fields", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const codexId = ProviderInstanceId.make("codex");

      yield* serverSettings.updateSettings({
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            accentColor: "#7c3aed",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Work",
            enabled: true,
            config: { homePath: "~/.codex" },
          },
        },
      });

      assert.deepEqual(next.providerInstances[codexId], {
        driver: ProviderDriverKind.make("codex"),
        displayName: "Codex Work",
        enabled: true,
        config: { homePath: "~/.codex" },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("enables previously used providers from sparse settings files", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providers":{"opencode":{"serverUrl":"http://127.0.0.1:4096"}}}',
      );
      yield* recordProviderUsage("opencode");

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.grok.enabled);
      assert.isTrue(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
      assert.equal(settings.providers.opencode.serverUrl, "http://127.0.0.1:4096");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves existing provider instances without explicit enabled flags", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"cursor_work":{"driver":"cursor","config":{}},"grok":{"driver":"grok","config":{}},"opencode_work":{"driver":"opencode","config":{"serverUrl":"http://127.0.0.1:4096"}},"opencode_unused":{"driver":"opencode","config":{}}}}',
      );
      yield* recordProviderUsage("cursor", "cursor_work");
      yield* recordProviderUsage("grok", null);
      yield* recordProviderUsage("opencode", "opencode_work");

      const settings = yield* serverSettings.getSettings;

      assert.isTrue(settings.providers.cursor.enabled);
      assert.isTrue(settings.providerInstances[ProviderInstanceId.make("cursor_work")]?.enabled);
      assert.isTrue(settings.providerInstances[ProviderInstanceId.make("grok")]?.enabled);
      assert.isTrue(settings.providerInstances[ProviderInstanceId.make("opencode_work")]?.enabled);
      const unused = settings.providerInstances[ProviderInstanceId.make("opencode_unused")];
      assert.isDefined(unused);
      assert.isFalse(resolveProviderInstanceEnabled(unused));
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves explicit provider disables in existing settings files", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providers":{"grok":{"enabled":false},"opencode":{"enabled":false},"cursor":{"enabled":false}},"providerInstances":{"grok":{"driver":"grok","enabled":false,"config":{}},"opencode":{"driver":"opencode","config":{"enabled":false}},"cursor":{"driver":"cursor","enabled":false,"config":{}}}}',
      );
      yield* recordProviderUsage("grok");
      yield* recordProviderUsage("opencode");
      yield* recordProviderUsage("cursor");

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
      assert.isFalse(settings.providerInstances[ProviderInstanceId.make("grok")]?.enabled);
      assert.isFalse(settings.providerInstances[ProviderInstanceId.make("opencode")]?.enabled);
      assert.isFalse(settings.providerInstances[ProviderInstanceId.make("cursor")]?.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("skips a disabled provider instance when picking the text generation fallback", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      // The Providers UI writes providerInstances only, so the legacy providers
      // map decodes to defaults where codex is enabled and listed first.
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"codex":{"driver":"codex","enabled":false,"config":{}}}}',
      );

      const settings = yield* serverSettings.getSettings;

      assert.equal(settings.textGenerationModelSelection.instanceId, "claudeAgent");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("keeps unused providers disabled in existing sparse settings files", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(serverConfig.settingsPath, "{}");

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves provider history when no settings file exists", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* recordProviderUsage("grok");

      const settings = yield* serverSettings.getSettings;

      assert.isTrue(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves provider history when the settings file is invalid", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(serverConfig.settingsPath, "{invalid json");
      yield* recordProviderUsage("cursor");

      const settings = yield* serverSettings.getSettings;

      assert.isTrue(settings.providers.cursor.enabled);
      assert.isFalse(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves valid provider flags when another settings field is invalid", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"addProjectBaseDirectory":42,"providers":{"cursor":{"enabled":false},"grok":{"enabled":true}}}',
      );
      yield* recordProviderUsage("cursor");

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.cursor.enabled);
      assert.isTrue(settings.providers.grok.enabled);
      assert.isFalse(settings.providers.opencode.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("restores providers from persisted runtime sessions", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO provider_session_runtime (
          thread_id,
          provider_name,
          provider_instance_id,
          adapter_key,
          status,
          last_seen_at
        )
        VALUES (
          ${"thread-opencode-runtime"},
          ${"opencode"},
          ${"opencode"},
          ${"opencode"},
          ${"ready"},
          ${"2026-08-25T00:00:00.000Z"}
        )
      `;

      const settings = yield* serverSettings.getSettings;

      assert.isFalse(settings.providers.grok.enabled);
      assert.isTrue(settings.providers.opencode.enabled);
      assert.isFalse(settings.providers.cursor.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists explicit disables after a provider has been used", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      yield* recordProviderUsage("grok");

      assert.isTrue((yield* serverSettings.getSettings).providers.grok.enabled);

      const settings = yield* serverSettings.updateSettings({
        providers: { grok: { enabled: false } },
      });
      assert.isFalse(settings.providers.grok.enabled);

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.isFalse(JSON.parse(raw).providers.grok.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists explicit provider enables before their first use", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          cursor: { enabled: true },
          grok: { enabled: true },
          opencode: { enabled: true },
        },
      });
      yield* serverSettings.updateSettings({ addProjectBaseDirectory: "~/Development" });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw);
      assert.isTrue(persisted.providers.cursor.enabled);
      assert.isTrue(persisted.providers.grok.enabled);
      assert.isTrue(persisted.providers.opencode.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("keeps optional providers disabled after a new installation writes settings", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const initial = yield* serverSettings.getSettings;
      assert.isFalse(initial.providers.grok.enabled);
      assert.isFalse(initial.providers.opencode.enabled);
      assert.isFalse(initial.providers.cursor.enabled);

      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
        providerInstances: {
          [ProviderInstanceId.make("grok")]: {
            driver: ProviderDriverKind.make("grok"),
            config: {},
          },
        },
      });

      assert.isFalse(next.providers.grok.enabled);
      assert.isFalse(next.providers.opencode.enabled);
      assert.isFalse(next.providers.cursor.enabled);
      const grok = next.providerInstances[ProviderInstanceId.make("grok")];
      assert.isDefined(grok);
      assert.isFalse(resolveProviderInstanceEnabled(grok));

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const persisted = JSON.parse(raw);
      assert.isFalse(persisted.providers.cursor.enabled);
      assert.isFalse(persisted.providers.grok.enabled);
      assert.isFalse(persisted.providers.opencode.enabled);
      assert.isUndefined(persisted.providerInstances.grok.enabled);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("folds a legacy in-config enabled flag into the envelope on load", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      // Old settings files can carry both flags with conflicting values.
      // The explicit false must win so a user's disable sticks.
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        '{"providerInstances":{"grok":{"driver":"grok","enabled":true,"config":{"enabled":false}},"codex_work":{"driver":"codex","config":{"enabled":true,"homePath":"~/.codex"}},"cursor":{"driver":"cursor","config":{"enabled":"nope"}}}}',
      );

      const settings = yield* serverSettings.getSettings;

      const grokId = ProviderInstanceId.make("grok");
      const codexWorkId = ProviderInstanceId.make("codex_work");
      assert.deepEqual(settings.providerInstances[grokId], {
        driver: ProviderDriverKind.make("grok"),
        enabled: false,
        config: {},
      });
      // A lone in-config flag is lifted to the envelope and stripped.
      assert.deepEqual(settings.providerInstances[codexWorkId], {
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        config: { homePath: "~/.codex" },
      });
      // A malformed flag is left alone so driver schema validation can
      // surface it instead of the fold silently repairing the config.
      assert.deepEqual(settings.providerInstances[ProviderInstanceId.make("cursor")], {
        driver: ProviderDriverKind.make("cursor"),
        config: { enabled: "nope" },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("folds in-config enabled flags arriving through updates", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const grokId = ProviderInstanceId.make("grok");

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [grokId]: {
            driver: ProviderDriverKind.make("grok"),
            enabled: true,
            config: { enabled: false, binaryPath: "/opt/grok" },
          },
        },
      });

      assert.deepEqual(next.providerInstances[grokId], {
        driver: ProviderDriverKind.make("grok"),
        enabled: false,
        config: { binaryPath: "/opt/grok" },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            binaryPath: "  /opt/homebrew/bin/claude  ",
          },
          opencode: {
            binaryPath: "  /opt/homebrew/bin/opencode  ",
            serverUrl: "  http://127.0.0.1:4096  ",
            serverPassword: "  secret-password  ",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        shadowHomePath: "",
        launchArgs: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        homePath: "",
        customModels: [],
        launchArgs: "",
        autoCompactWindow: "",
      });
      assert.deepEqual(next.providers.opencode, {
        // OpenCode is disabled by default; this update only touches paths.
        enabled: false,
        binaryPath: "/opt/homebrew/bin/opencode",
        serverUrl: "http://127.0.0.1:4096",
        serverPassword: "secret-password",
        customModels: [],
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "  ~/Development  ",
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.equal(next.addProjectBaseDirectory, "~/Development");
      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes non-default settings and explicit optional provider defaults to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
          opencode: {
            serverUrl: "http://127.0.0.1:4096",
            serverPassword: "secret-password",
          },
        },
        automaticGitFetchInterval: Duration.seconds(10),
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(raw), {
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
          cursor: {
            enabled: false,
          },
          grok: {
            enabled: false,
          },
          opencode: {
            enabled: false,
            serverUrl: "http://127.0.0.1:4096",
            serverPassword: "secret-password",
          },
        },
        backgroundActivity: {
          schemaVersion: 1,
          profile: "custom",
          baseProfile: "balanced",
          overrides: {
            automaticGitFetchInterval: 10_000,
          },
        },
        automaticGitFetchInterval: 10_000,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("keeps the inline value on disk when secret migration fails", () => {
    const cause = new ServerSecretStore.SecretStorePersistError({
      resource: "provider environment secret",
      cause: new Error("Secret storage unavailable"),
    });
    const secretLayer = Layer.effect(
      ServerSecretStore.ServerSecretStore,
      Effect.map(ServerSecretStore.ServerSecretStore, (store) => ({
        ...store,
        set: () => Effect.fail(cause),
      })),
    ).pipe(Layer.provide(ServerSecretStore.layer));
    const settingsLayer = ServerSettingsModule.layer.pipe(
      Layer.provide(secretLayer),
      Layer.provideMerge(Layer.fresh(SqlitePersistenceMemory)),
      Layer.provideMerge(
        Layer.fresh(
          ServerConfig.layerTest(process.cwd(), {
            prefix: "t3code-inline-secret-failure-test-",
          }),
        ),
      ),
    );
    return Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex_personal");
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const original =
        '{"providerInstances":{"codex_personal":{"driver":"codex","environment":[{"name":"API_TOKEN","value":"inline-test-token","sensitive":true}],"config":{}}}}';
      yield* fs.writeFileString(config.settingsPath, original);
      const error = yield* Effect.flip(
        service.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              environment: [{ name: "API_TOKEN", value: "", sensitive: true, valueRedacted: true }],
              config: {},
            },
          },
        }),
      );
      assert.equal(error.operation, "write-secret");
      assert.strictEqual(error.cause, cause);
      assert.equal(yield* fs.readFileString(config.settingsPath), original);
      const settings = yield* service.getSettings;
      assert.equal(
        settings.providerInstances[instanceId]?.environment?.[0]?.value,
        "inline-test-token",
      );
    }).pipe(Effect.provide(settingsLayer));
  });

  for (const { label, variable, expected, duplicate } of [
    {
      label: "preserves an inline secret on a redacted settings save",
      variable: { name: "API_TOKEN", value: "", sensitive: true, valueRedacted: true },
      expected: "inline-test-token",
    },
    {
      label: "preserves the effective last inline secret when names are duplicated",
      variable: { name: "API_TOKEN", value: "", sensitive: true, valueRedacted: true },
      expected: "last-inline-test-token",
      duplicate: true,
    },
    {
      label: "replaces an inline secret with an explicit value",
      variable: { name: "API_TOKEN", value: "replacement-test-token", sensitive: true },
      expected: "replacement-test-token",
    },
    {
      label: "clears an inline secret with an explicit empty value",
      variable: { name: "API_TOKEN", value: "", sensitive: true },
      expected: "",
    },
  ]) {
    it.effect(label, () =>
      Effect.gen(function* () {
        const instanceId = ProviderInstanceId.make("codex_personal");
        const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
        const serverConfig = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.writeFileString(
          serverConfig.settingsPath,
          duplicate
            ? '{"providerInstances":{"codex_personal":{"driver":"codex","environment":[{"name":"API_TOKEN","value":"inline-test-token","sensitive":true},{"name":"API_TOKEN","value":"last-inline-test-token","sensitive":true}],"config":{}}}}'
            : '{"providerInstances":{"codex_personal":{"driver":"codex","environment":[{"name":"API_TOKEN","value":"inline-test-token","sensitive":true}],"config":{}}}}',
        );
        const initial = yield* serverSettings.getSettings;
        assert.equal(
          initial.providerInstances[instanceId]?.environment?.[0]?.value,
          "inline-test-token",
        );

        const next = yield* serverSettings.updateSettings({
          providerInstances: {
            [instanceId]: {
              driver: ProviderDriverKind.make("codex"),
              displayName: "Renamed provider",
              environment: duplicate ? [variable, variable] : [variable],
              config: {},
            },
          },
        });
        assert.equal(next.providerInstances[instanceId]?.environment?.[0]?.value, expected);
        const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
        assert.notInclude(raw, "inline-test-token");
        assert.notInclude(raw, "replacement-test-token");

        const reloaded = yield* Effect.gen(function* () {
          const fresh = yield* ServerSettingsModule.ServerSettingsService;
          return yield* fresh.getSettings;
        }).pipe(
          Effect.provide(
            Layer.fresh(ServerSettingsModule.layer).pipe(Layer.provide(ServerSecretStore.layer)),
          ),
        );
        assert.equal(reloaded.providerInstances[instanceId]?.environment?.[0]?.value, expected);
      }).pipe(Effect.provide(makeServerSettingsLayer())),
    );
  }

  it.effect("stores sensitive provider instance environment values outside settings.json", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const instanceId = ProviderInstanceId.make("codex_personal");

      const next = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            environment: [
              { name: "OPENROUTER_API_KEY", value: "sk-or-secret", sensitive: true },
              { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
            ],
            config: {},
          },
        },
      });

      assert.deepEqual(next.providerInstances[instanceId]?.environment, [
        {
          name: "OPENROUTER_API_KEY",
          value: "sk-or-secret",
          sensitive: true,
          valueRedacted: true,
        },
        { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
      ]);

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.notInclude(raw, "sk-or-secret");
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      assert.deepEqual(JSON.parse(raw).providerInstances.codex_personal.environment, [
        {
          name: "OPENROUTER_API_KEY",
          value: "",
          sensitive: true,
          valueRedacted: true,
        },
        { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
      ]);

      const roundTripped = yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            displayName: "Codex Personal",
            environment: [
              { name: "OPENROUTER_API_KEY", value: "", sensitive: true, valueRedacted: true },
              { name: "ANTHROPIC_BASE_URL", value: "https://openrouter.ai/api", sensitive: false },
            ],
            config: {},
          },
        },
      });

      assert.equal(
        roundTripped.providerInstances[instanceId]?.environment?.[0]?.value,
        "sk-or-secret",
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("materializes provider secrets for terminal environment resolution", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsModule.ServerSettingsService;
      const serverConfig = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const instanceId = ProviderInstanceId.make("codex_terminal");

      yield* serverSettings.updateSettings({
        providerInstances: {
          [instanceId]: {
            driver: ProviderDriverKind.make("codex"),
            environment: [
              { name: "OPENROUTER_API_KEY", value: "sk-terminal-secret", sensitive: true },
            ],
            config: { homePath: "~/.codex-terminal" },
          },
        },
      });

      const environment = yield* resolveProviderInstanceTerminalEnvironment({
        serverSettings,
        path,
        rawProviderInstanceId: instanceId,
        env: undefined,
      });
      const persisted = yield* fileSystem.readFileString(serverConfig.settingsPath);

      assert.equal(environment.OPENROUTER_API_KEY, "sk-terminal-secret");
      assert.match(environment.CODEX_HOME ?? "", /[\\/][.]codex-terminal$/);
      assert.notInclude(persisted, "sk-terminal-secret");
      assert.include(persisted, '"valueRedacted": true');
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});

it.layer(NodeServices.layer)("routine schedule persistence", (it) => {
  const routine = {
    name: "Daily review",
    enabled: true,
    cron: "0 7 * * *",
    timeZone: "America/Vancouver",
    projectId: ProjectId.make("routine-project"),
    prompt: "Review this project.",
    modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-6.1-sol"),
    runtimeMode: "approval-required" as const,
    interactionMode: "default" as const,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: "never" as const,
    lastThreadId: null,
    lastError: null,
  };
  it.effect(
    "checks future occurrences against the server clock, including explicit legacy years",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2000-01-01T00:00:00.000Z"));
        const service = yield* ServerSettingsModule.ServerSettingsService;
        const datedRoutine = { ...routine, cron: "0 0 7 1 1 * 2010" };
        const saved = yield* service.updateSettings({ routines: { dated: datedRoutine } });
        assert.equal(saved.routines.dated?.cron, datedRoutine.cron);
        yield* TestClock.setTime(Date.parse("2011-01-01T00:00:00.000Z"));
        const expired = yield* service
          .updateSettings({ routines: { expired: datedRoutine } })
          .pipe(Effect.result);
        assert.equal(expired._tag, "Failure");
        assert.equal((yield* service.getSettings).routines.expired, undefined);
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
  it.effect("allows a manual run of an exhausted schedule but rejects resuming it", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      yield* TestClock.setTime(Date.parse("2000-01-01T00:00:00.000Z"));
      yield* service.updateSettings({
        routines: { dated: { ...routine, enabled: false, cron: "0 0 7 1 1 * 2010" } },
      });
      yield* TestClock.setTime(Date.parse("2026-10-02T12:00:00.000Z"));
      const resume = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: { dated: { _tag: "RoutineAction", action: "resume" } },
      }).pipe(Effect.result);
      assert.equal(resume._tag, "Failure");
      assert.equal((yield* service.getSettings).routines.dated!.enabled, false);
      const queued = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: { dated: { _tag: "RoutineAction", action: "run-now" } },
      });
      assert.equal(queued.routines.dated!.nextRunAt, "2026-10-02T11:59:59.000Z");
      assert.equal(queued.routines.dated!.enabled, true);
      assert.equal(queued.routines.dated!.lastRunStatus, "never");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
  it.effect("rejects invalid edited schedules without writing any part of the settings patch", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      yield* service.updateSettings({ routines: { daily: routine } });
      const before = yield* fs.readFileString(config.settingsPath);
      for (const edit of [
        { cron: "99 7 * * *" },
        { cron: "0 25 * * *" },
        { cron: "0 7 31 2 *" },
        { cron: "2027-01-01T07:00:00Z" },
        { timeZone: "Mars/Crater" },
      ]) {
        const result = yield* service
          .updateSettings({ routines: { daily: { ...routine, ...edit } } })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        assert.equal(yield* fs.readFileString(config.settingsPath), before);
        assert.equal((yield* service.getSettings).routines.daily?.cron, routine.cron);
      }
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
  it.effect("keeps existing invalid schedules repairable, pausable and removable", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const previous = (yield* service.getSettings).routines.legacy!;
      const paused = yield* service.updateSettings({
        routines: { legacy: { ...previous, enabled: false } },
      });
      assert.equal(paused.routines.legacy?.enabled, false);
      const fixed = yield* service.updateSettings({
        routines: { legacy: { ...previous, cron: "0 9 * * MON-FRI" } },
      });
      assert.equal(fixed.routines.legacy?.cron, "0 9 * * MON-FRI");
      const removed = yield* service.updateSettings({ routines: { legacy: null } });
      assert.equal(removed.routines.legacy, undefined);
    }).pipe(
      Effect.provide(
        ServerSettingsModule.layerTest({
          routines: { legacy: { ...routine, cron: "99 7 * * *" } },
        }),
      ),
    ),
  );
});

it.layer(NodeServices.layer)("atomic settings updates", (it) => {
  it.effect("serializes functional routine edits against the latest persisted settings", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const routine = {
        name: "Concurrent edits",
        enabled: false,
        cron: "0 7 * * *",
        timeZone: "UTC",
        projectId: ProjectId.make("routine-project"),
        prompt: "start",
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "test-model"),
        runtimeMode: "approval-required" as const,
        interactionMode: "default" as const,
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: "never" as const,
        lastThreadId: null,
        lastError: null,
      };
      yield* service.updateSettings({ routines: { daily: routine } });
      yield* Effect.all(
        Array.from({ length: 16 }, (_, index) =>
          service.updateSettings((current) => {
            const latest = current.routines.daily!;
            return { routines: { daily: { ...latest, prompt: `${latest.prompt} ${index}` } } };
          }),
        ),
        { concurrency: "unbounded" },
      );
      const latest = (yield* service.getSettings).routines.daily!;
      assert.deepEqual(
        new Set(latest.prompt.split(" ")),
        new Set(["start", ...Array.from({ length: 16 }, (_, index) => String(index))]),
      );
      yield* service.updateSettings({ routines: { daily: null } });
      const skipped = yield* service.updateSettings((current) =>
        current.routines.daily ? { routines: { daily: routine } } : null,
      );
      assert.equal(skipped.routines.daily, undefined);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});

const clientRoutine = {
  name: "Daily review",
  enabled: true,
  cron: "0 7 * * *",
  timeZone: "UTC",
  projectId: ProjectId.make("routine-project"),
  prompt: "Newest instructions",
  modelSelection: createModelSelection(ProviderInstanceId.make("codex-work"), "test-model"),
  runtimeMode: "approval-required" as const,
  interactionMode: "plan" as const,
  nextRunAt: "2026-10-03T07:00:00.000Z",
  lastRunAt: "2026-10-02T07:00:00.000Z",
  lastRunStatus: "launched" as const,
  lastThreadId: ThreadId.make("newest-routine-task"),
  lastError: null,
};

it.layer(NodeServices.layer)("client routine mutations", (it) => {
  it.effect("ignores provider-option order and accepts retries but protects changed options", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      const baseline = {
        ...clientRoutine,
        modelSelection: {
          ...clientRoutine.modelSelection,
          options: [
            { id: "reasoning", value: "high" },
            { id: "fast", value: true },
          ],
        },
      };
      yield* service.updateSettings({ routines: { daily: baseline } });
      const draft = { ...baseline, name: "Renamed" };
      const expected = {
        ...baseline,
        modelSelection: {
          ...baseline.modelSelection,
          options: baseline.modelSelection.options.toReversed(),
        },
      };
      const patch = {
        routines: { daily: { _tag: "RoutineEdit" as const, routine: draft, expected } },
      };
      const saved = yield* ServerSettingsModule.updateClientSettings(service, patch);
      const retried = yield* ServerSettingsModule.updateClientSettings(service, patch);
      assert.deepEqual(retried.routines.daily, saved.routines.daily);
      yield* service.updateSettings((current) => ({
        routines: {
          daily: {
            ...current.routines.daily!,
            modelSelection: {
              ...baseline.modelSelection,
              options: [
                { id: "reasoning", value: "low" },
                { id: "fast", value: true },
              ],
            },
          },
        },
      }));
      const rejected = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: {
          daily: {
            _tag: "RoutineEdit",
            expected: saved.routines.daily!,
            routine: { ...draft, name: "Another rename" },
          },
        },
      }).pipe(Effect.flip);
      assert.include(rejected.message, "changed on another device");
      assert.deepEqual((yield* service.getSettings).routines.daily!.modelSelection.options, [
        { id: "reasoning", value: "low" },
        { id: "fast", value: true },
      ]);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("rejects a stale configuration while preserving the newer saved version", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      yield* service.updateSettings({ routines: { daily: clientRoutine } });
      const otherDevice = {
        ...clientRoutine,
        prompt: "Instructions from another device",
        modelSelection: createModelSelection(
          ProviderInstanceId.make("codex-personal"),
          "another-model",
        ),
      };
      yield* service.updateSettings({ routines: { daily: otherDevice } });
      const rejected = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: {
          daily: {
            _tag: "RoutineEdit",
            expected: clientRoutine,
            routine: { ...clientRoutine, name: "Local unsaved name" },
          },
        },
      }).pipe(Effect.flip);
      assert.include(rejected.message, "changed on another device");
      assert.deepEqual((yield* service.getSettings).routines.daily, otherDevice);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("commits only one of two concurrent saves based on the same configuration", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      yield* service.updateSettings({ routines: { daily: clientRoutine } });
      const results = yield* Effect.all(
        ["First edit", "Second edit"].map((prompt) =>
          ServerSettingsModule.updateClientSettings(service, {
            routines: {
              daily: {
                _tag: "RoutineEdit",
                expected: clientRoutine,
                routine: { ...clientRoutine, prompt },
              },
            },
          }).pipe(Effect.exit),
        ),
        { concurrency: "unbounded" },
      );
      assert.equal(results.filter((result) => result._tag === "Success").length, 1);
      assert.equal(results.filter((result) => result._tag === "Failure").length, 1);
      assert.include(
        ["First edit", "Second edit"],
        (yield* service.getSettings).routines.daily!.prompt,
      );
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("retains authoritative history when a delayed configuration save reaches disk", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      yield* service.updateSettings({ routines: { daily: clientRoutine } });
      const stale = {
        ...clientRoutine,
        prompt: "Edited instructions",
        nextRunAt: null,
        lastRunAt: null,
        lastRunStatus: "never" as const,
        lastThreadId: null,
        lastError: null,
      };
      const patch = yield* decodeClientSettingsPatch({
        routines: { daily: { _tag: "RoutineEdit", routine: stale, expected: clientRoutine } },
      });
      const saved = yield* ServerSettingsModule.updateClientSettings(service, patch);
      // A saved routine always carries its overlap policy; "allow" is the shipped default.
      assert.deepEqual(saved.routines.daily, {
        ...clientRoutine,
        prompt: "Edited instructions",
        overlapPolicy: "allow",
      });
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const persisted = yield* decodePersistedSettings(
        yield* fs.readFileString(config.settingsPath),
      );
      assert.deepEqual(persisted.routines.daily, saved.routines.daily);
      const changed = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: {
          daily: {
            _tag: "RoutineEdit",
            routine: { ...stale, cron: "0 8 * * *" },
            expected: saved.routines.daily!,
          },
        },
      });
      assert.equal(changed.routines.daily!.nextRunAt, null);
      assert.equal(changed.routines.daily!.lastThreadId, clientRoutine.lastThreadId);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("uses the latest subscription and instructions for actions, on the server clock", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      yield* service.updateSettings({
        routines: {
          daily: { ...clientRoutine, lastRunStatus: "failed", lastError: "Provider unavailable" },
        },
      });
      const pause = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: { daily: { _tag: "RoutineAction", action: "pause" } },
      });
      assert.equal(pause.routines.daily!.enabled, false);
      assert.equal(pause.routines.daily!.lastError, "Provider unavailable");
      const now = Date.parse("2026-10-02T12:00:00.000Z");
      yield* TestClock.setTime(now);
      const queued = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: { daily: { _tag: "RoutineAction", action: "run-now" } },
      });
      assert.deepEqual(queued.routines.daily, {
        ...clientRoutine,
        enabled: true,
        nextRunAt: "2026-10-02T11:59:59.000Z",
        lastRunStatus: "never",
      });
      const resumed = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: { daily: { _tag: "RoutineAction", action: "resume" } },
      });
      assert.equal(resumed.routines.daily!.nextRunAt, queued.routines.daily!.nextRunAt);
      yield* service.updateSettings((current) => ({
        routines: { daily: { ...current.routines.daily!, lastRunStatus: "running" } },
      }));
      const rejected = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: { daily: { _tag: "RoutineAction", action: "run-now" } },
      }).pipe(Effect.flip);
      assert.include(rejected.message, "already starting");
      assert.equal((yield* service.getSettings).routines.daily!.lastRunStatus, "running");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect(
    "rejects deleted edits and actions without resurrecting them or partially applying a patch",
    () =>
      Effect.gen(function* () {
        const service = yield* ServerSettingsModule.ServerSettingsService;
        for (const mutation of [
          { _tag: "RoutineEdit", routine: clientRoutine, expected: clientRoutine } as const,
          { _tag: "RoutineAction", action: "run-now" } as const,
          { _tag: "RoutineAction", action: "pause" } as const,
          { _tag: "RoutineAction", action: "resume" } as const,
        ]) {
          const rejected = yield* ServerSettingsModule.updateClientSettings(service, {
            defaultAutoPull: true,
            routines: { deleted: mutation },
          }).pipe(Effect.flip);
          assert.include(rejected.message, "removed on another device");
          const unchanged = yield* service.getSettings;
          assert.equal(unchanged.routines.deleted, undefined);
          assert.equal(unchanged.defaultAutoPull, DEFAULT_SERVER_SETTINGS.defaultAutoPull);
        }
        const created = yield* ServerSettingsModule.updateClientSettings(service, {
          routines: { fresh: clientRoutine },
        });
        assert.equal(created.routines.fresh!.lastRunStatus, "never");
        assert.equal(created.routines.fresh!.lastRunAt, null);
        assert.equal(created.routines.fresh!.lastThreadId, null);
        assert.equal(created.routines.fresh!.nextRunAt, null);
      }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("accepts legacy configuration saves but rejects ambiguous legacy launch markers", () =>
    Effect.gen(function* () {
      const service = yield* ServerSettingsModule.ServerSettingsService;
      yield* service.updateSettings({ routines: { daily: clientRoutine } });
      const saved = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: { daily: { ...clientRoutine, name: "Renamed", lastThreadId: null } },
      });
      assert.equal(saved.routines.daily!.lastThreadId, clientRoutine.lastThreadId);
      const rejected = yield* ServerSettingsModule.updateClientSettings(service, {
        routines: {
          daily: {
            ...clientRoutine,
            nextRunAt: "2026-10-01T00:00:00.000Z",
            lastRunStatus: "never",
          },
        },
      }).pipe(Effect.flip);
      assert.include(rejected.message, "Update this client");
      assert.equal((yield* service.getSettings).routines.daily!.name, "Renamed");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
