/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=7m; seat=codex; date=2026-10-15 */
/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=15m; seat=codex; date=2026-10-14 */
/* agent-watermark: model=haiku-5.5; effort=high; duration=10m; seat=claude-code; date=2026-10-12 */
/* agent-watermark: model=grok-4.7; effort=default; duration=40m; seat=cursor; date=2026-09-30 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=2m; seat=antigravity; date=2026-10-02 */
// @effect-diagnostics nodeBuiltinImport:off - the suite seeds and grows real
// transcript trees on disk, outside the service's Effect FileSystem.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import {
  UsageDay,
  ProviderDriverKind,
  ProviderInstanceId,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Scheduler from "effect/Scheduler";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageService from "./UsageService.ts";
import { encodeScanCache } from "./usageScanCache.ts";
import { parseClaudeLine } from "./usageTranscripts.ts";

function claudeLine(id: number, outputTokens: number, model = "claude-fable-5"): string {
  return `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T10:00:00Z",
    requestId: `req_${id}`,
    sessionId: "session-1",
    message: {
      id: `msg_${id}`,
      model,
      usage: { input_tokens: 10, output_tokens: outputTokens },
    },
  })}\n`;
}

const encodeLegacyFixture = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Unknown as unknown as Schema.Codec<unknown>),
);
const decodeHistoryFixture = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ historyVersion: Schema.Number })),
);

const WINDOW: UsageSummaryInput = {
  timeZone: "UTC",
  sinceDay: UsageDay.make("2026-07-31"),
  untilDay: UsageDay.make("2026-08-02"),
};

const setup = Effect.gen(function* () {
  const home = yield* Effect.promise(() =>
    NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-service-test-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
  );
  const transcriptDir = NodePath.join(home, "claude", "projects", "proj");
  yield* Effect.promise(() => NodeFSP.mkdir(transcriptDir, { recursive: true }));
  return {
    home,
    transcript: NodePath.join(transcriptDir, "session.jsonl"),
    settings: {
      providers: {
        claudeAgent: { homePath: NodePath.join(home, "claude") },
        codex: { homePath: NodePath.join(home, "codex") },
      },
    },
  };
});

const serviceLayers = (input: {
  readonly prefix: string;
  readonly home: string;
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly onRatesFetch?: () => void;
  /** Defaults to an unparsable document so every scan retries the fetch. */
  readonly ratesDocument?: unknown;
}) =>
  ServerConfig.layerTest(process.cwd(), NodePath.join(input.home, input.prefix)).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(ServerSettings.layerTest(input.settings)),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            input.onRatesFetch?.();
            // Unparsable rates: every scan retries the fetch, which makes the
            // fetch count a boundary-level observation of how many scans ran.
            return HttpClientResponse.fromWeb(request, Response.json(input.ratesDocument ?? {}));
          }),
        ),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(HostProcessEnvironment, {
        HOME: input.home,
        GROK_HOME: NodePath.join(input.home, "grok"),
      }),
    ),
  );

function totalOutputTokens(summary: { buckets: readonly { totals: { outputTokens: number } }[] }) {
  return summary.buckets.reduce((sum, bucket) => sum + bucket.totals.outputTokens, 0);
}

describe("UsageService", () => {
  it.live(
    "recovers removed transcripts from the legacy usage cache without requiring the old parse cache",
    () =>
      Effect.gen(function* () {
        const { transcript, settings, home } = yield* setup;
        const layers = serviceLayers({ prefix: "legacy-history", home, settings });
        const config = yield* ServerConfig.ServerConfig.pipe(Effect.provide(layers));
        const row = parseClaudeLine(claudeLine(1, 29))!;
        const encoded = encodeScanCache(
          new Map([
            [
              transcript,
              {
                provider: "claude" as const,
                size: 100,
                mtimeMs: 100,
                records: [row],
                tailRecords: [],
                position: { resumeOffset: 100, guardLength: 0, guardHash: 0, codexState: null },
              },
            ],
          ]),
        );
        const legacy = {
          ...encoded,
          version: 5,
          files: Object.fromEntries(
            Object.entries(encoded.files).map(([path, entry]) => [
              path,
              {
                ...entry,
                r: entry.r.map((record) => [
                  ...record.slice(0, 8),
                  "msg_1:req_1",
                  ...record.slice(9, 11),
                ]),
              },
            ]),
          ),
        };
        const serialized = yield* encodeLegacyFixture(legacy);
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(config.stateDir, "usage-scan-cache-v5.json"), serialized),
        );
        const service = yield* UsageService.make.pipe(Effect.provide(layers));
        assert.strictEqual(totalOutputTokens(yield* service.readSummary(WINDOW)), 29);
        const persisted = yield* decodeHistoryFixture(
          yield* Effect.promise(() =>
            NodeFSP.readFile(NodePath.join(config.stateDir, "usage-history.json"), "utf8"),
          ),
        );
        assert.strictEqual(persisted.historyVersion, 2);
        yield* Effect.promise(() =>
          NodeFSP.unlink(NodePath.join(config.stateDir, "usage-scan-cache-v5.json")),
        );
        const restarted = yield* UsageService.make.pipe(Effect.provide(layers));
        assert.strictEqual(totalOutputTokens(yield* restarted.readSummary(WINDOW)), 29);
      }).pipe(Effect.scoped),
  );

  it.live("replaces collapsed Claude history and cache with every original transcript row", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      const layers = serviceLayers({ prefix: "restore-row-accounting", home, settings });
      const config = yield* ServerConfig.ServerConfig.pipe(Effect.provide(layers));
      const collapsed = { ...parseClaudeLine(claudeLine(1, 70))!, dedupeKey: "old-message-id" };
      const encoded = encodeScanCache(
        new Map([
          [
            transcript,
            {
              provider: "claude" as const,
              size: 100,
              mtimeMs: 100,
              records: [collapsed],
              tailRecords: [],
              position: { resumeOffset: 100, guardLength: 0, guardHash: 0, codexState: null },
            },
          ],
        ]),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(transcript, claudeLine(1, 5) + claudeLine(1, 70) + claudeLine(1, 70)),
      );
      const oldHistory = yield* encodeLegacyFixture({ ...encoded, version: 8, historyVersion: 1 });
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(config.stateDir, "usage-history.json"), oldHistory),
      );
      const oldCache = yield* encodeLegacyFixture({ ...encoded, version: 8 });
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(config.stateDir, "usage-scan-cache.json"), oldCache),
      );
      const service = yield* UsageService.make.pipe(Effect.provide(layers));
      assert.strictEqual(totalOutputTokens(yield* service.readSummary(WINDOW)), 145);
      const restarted = yield* UsageService.make.pipe(Effect.provide(layers));
      assert.strictEqual(totalOutputTokens(yield* restarted.readSummary(WINDOW)), 145);
      yield* Effect.promise(() => NodeFSP.unlink(transcript));
      const retained = yield* UsageService.make.pipe(Effect.provide(layers));
      assert.strictEqual(totalOutputTokens(yield* retained.readSummary(WINDOW)), 145);
    }).pipe(Effect.scoped),
  );

  it.live("retains lifetime usage after deletion, process restart and a narrow-window scan", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      const base = NodePath.join(home, "server-state");
      const layers = ServerConfig.layerTest(process.cwd(), base).pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(ServerSettings.layerTest(settings)),
        Layer.provideMerge(Layer.succeed(HostProcessEnvironment, { HOME: home })),
        Layer.provideMerge(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}))),
            ),
          ),
        ),
      );
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 17)));
      const first = yield* UsageService.make.pipe(Effect.provide(layers));
      assert.strictEqual(totalOutputTokens(yield* first.readSummary(WINDOW)), 17);
      yield* Effect.promise(() => NodeFSP.unlink(transcript));
      assert.strictEqual(totalOutputTokens(yield* first.readSummary(WINDOW)), 17);
      const restarted = yield* UsageService.make.pipe(Effect.provide(layers));
      assert.strictEqual(
        totalOutputTokens(
          yield* restarted.readSummary({ ...WINDOW, sinceDay: UsageDay.make("2026-08-02") }),
        ),
        0,
      );
      const recovered = yield* restarted.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(recovered), 17);
      assert.ok(
        recovered.sources.some((source) => source.message?.includes("retained transcript")),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(transcript, claudeLine(1, 17) + claudeLine(2, 6)),
      );
      assert.strictEqual(totalOutputTokens(yield* restarted.readSummary(WINDOW)), 23);
    }).pipe(Effect.scoped),
  );

  it.live("includes configured Claude instances and archived Codex usage", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      const secondary = NodePath.join(home, "secondary");
      const archived = NodePath.join(home, "codex", "archived_sessions");
      yield* Effect.promise(async () => {
        await NodeFSP.writeFile(transcript, claudeLine(1, 5));
        await NodeFSP.mkdir(NodePath.join(secondary, "projects", "proj"), { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(secondary, "projects", "proj", "other.jsonl"),
          claudeLine(2, 7),
        );
        await NodeFSP.mkdir(archived, { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(archived, "old.jsonl"),
          [
            { type: "session_meta", payload: { id: "archived-session" } },
            { type: "turn_context", payload: { model: "codex-fixture" } },
            {
              type: "event_msg",
              timestamp: "2026-08-01T10:00:00Z",
              payload: {
                type: "token_count",
                info: { last_token_usage: { input_tokens: 20, output_tokens: 9 } },
              },
            },
          ]
            .map((row) => JSON.stringify(row))
            .join("\n") + "\n",
        );
      });
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-extra-homes",
            home,
            settings: {
              ...settings,
              providerInstances: {
                [ProviderInstanceId.make("extra")]: {
                  driver: ProviderDriverKind.make("claudeAgent"),
                  config: { homePath: secondary },
                  enabled: false,
                },
              },
            },
          }),
        ),
      );
      const summary = yield* service.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(summary), 21);
      assert.strictEqual(
        summary.buckets
          .filter((bucket) => bucket.provider === "claude")
          .reduce((n, bucket) => n + bucket.totals.outputTokens, 0),
        12,
      );
      assert.isTrue(summary.buckets.every((bucket) => bucket.sourceId !== undefined));
    }).pipe(Effect.scoped),
  );

  it.live("reports malformed usage consistently across incremental scans and cache hits", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() =>
        NodeFSP.writeFile(transcript, claudeLine(1, 5) + '{"usage": broken}\n'),
      );
      const service = yield* UsageService.make.pipe(
        Effect.provide(serviceLayers({ prefix: "usage-malformed", home, settings })),
      );
      const check = (summary: {
        sources: readonly {
          fingerprint: { provider: string };
          malformedRecords: number;
          status: string;
        }[];
      }) => {
        const source = summary.sources.find((item) => item.fingerprint.provider === "claude");
        assert.strictEqual(source?.malformedRecords, 1);
        assert.strictEqual(source?.status, "partial");
      };
      check(yield* service.readSummary(WINDOW));
      check(yield* service.readSummary(WINDOW));
      yield* Effect.promise(() => NodeFSP.appendFile(transcript, claudeLine(2, 7)));
      const grown = yield* service.readSummary(WINDOW);
      check(grown);
      assert.strictEqual(totalOutputTokens(grown), 12);
    }).pipe(Effect.scoped),
  );

  it.live("marks unreadable paths as partial instead of reporting complete empty usage", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(async () => {
        await NodeFSP.writeFile(transcript, claudeLine(1, 5));
        await NodeFSP.symlink(
          NodePath.join(home, "missing-target"),
          NodePath.join(NodePath.dirname(transcript), "broken.jsonl"),
        );
      });
      const service = yield* UsageService.make.pipe(
        Effect.provide(serviceLayers({ prefix: "usage-read-failure", home, settings })),
      );
      const summary = yield* service.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(summary), 5);
      assert.strictEqual(
        summary.sources.find((source) => source.fingerprint.provider === "claude")?.status,
        "partial",
      );
    }).pipe(Effect.scoped),
  );

  it.live("reprices unchanged transcripts when custom prices are added, edited, or removed", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5, "example-model")));

      yield* Effect.gen(function* () {
        const settingsService = yield* ServerSettings.ServerSettingsService;
        const service = yield* UsageService.make;

        const original = yield* service.readSummary(WINDOW);
        assert.strictEqual(original.buckets[0]?.costUsd, 0);
        assert.strictEqual(original.buckets[0]?.unpricedRecords, 1);

        yield* settingsService.updateSettings({
          usagePriceOverrides: {
            "example-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
          },
        });
        const overridden = yield* service.readSummary(WINDOW);
        assert.closeTo(overridden.buckets[0]?.costUsd ?? -1, 0.00006, 1e-12);
        assert.strictEqual(overridden.buckets[0]?.costSource, "modelPriced");
        assert.strictEqual(overridden.buckets[0]?.unpricedRecords, 0);
        assert.deepStrictEqual(overridden.buckets[0]?.totals, original.buckets[0]?.totals);

        yield* settingsService.updateSettings({
          usagePriceOverrides: {
            "example-model": { inputCostPerMillionTokens: 4, outputCostPerMillionTokens: 16 },
          },
        });
        const edited = yield* service.readSummary(WINDOW);
        assert.closeTo(edited.buckets[0]?.costUsd ?? -1, 0.00012, 1e-12);

        yield* settingsService.updateSettings({ usagePriceOverrides: { "example-model": null } });
        const restored = yield* service.readSummary(WINDOW);
        assert.deepStrictEqual(restored.buckets, original.buckets);
      }).pipe(
        Effect.provide(
          serviceLayers({ prefix: "usage-service-price-overrides-test", home, settings }),
        ),
      );
    }).pipe(Effect.scoped),
  );

  it.live("preserves original Claude row accounting on incremental scans and across files", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));
      const service = yield* UsageService.make.pipe(
        Effect.provide(serviceLayers({ prefix: "usage-snapshots-test", home, settings })),
      );
      assert.strictEqual(totalOutputTokens(yield* service.readSummary(WINDOW)), 5);
      yield* Effect.promise(() =>
        NodeFSP.appendFile(transcript, claudeLine(1, 70) + claudeLine(1, 70)),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(NodePath.dirname(transcript), "copy.jsonl"),
          claudeLine(1, 5),
        ),
      );
      const revised = yield* service.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(revised), 150);
      assert.strictEqual(revised.buckets[0]?.totals.uncachedInputTokens, 40);
      assert.strictEqual(revised.buckets[0]?.records, 4);
      assert.deepStrictEqual((yield* service.readSummary(WINDOW)).buckets, revised.buckets);
    }).pipe(Effect.scoped),
  );

  it.live("counts appended usage on a rescan of a grown transcript", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      const service = yield* UsageService.make.pipe(
        Effect.provide(serviceLayers({ prefix: "usage-service-grow-test", home, settings })),
      );

      const first = yield* service.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(first), 5);

      yield* Effect.promise(() => NodeFSP.appendFile(transcript, claudeLine(2, 7)));
      const second = yield* service.readSummary(WINDOW);
      assert.strictEqual(totalOutputTokens(second), 12);
    }).pipe(Effect.scoped),
  );

  it.live("does not share an in-flight scan after custom prices change", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5, "example-model")));

      yield* Effect.gen(function* () {
        const settingsService = yield* ServerSettings.ServerSettingsService;
        const fileSystem = yield* FileSystem.FileSystem;
        const firstScanStarted = yield* Deferred.make<void>();
        const secondScanStarted = yield* Deferred.make<void>();
        const releaseRates = yield* Deferred.make<void>();
        let homeProbes = 0;
        const service = yield* UsageService.make.pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fileSystem,
            exists: (path) =>
              fileSystem.exists(path).pipe(
                Effect.tap(() => {
                  if (path !== NodePath.join(home, "claude", ".claude", "projects"))
                    return Effect.void;
                  homeProbes += 1;
                  return Deferred.succeed(
                    homeProbes === 1 ? firstScanStarted : secondScanStarted,
                    undefined,
                  );
                }),
              ),
          }),
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Deferred.await(releaseRates).pipe(
                Effect.as(HttpClientResponse.fromWeb(request, Response.json({}))),
              ),
            ),
          ),
        );

        const first = yield* service.readSummary(WINDOW).pipe(Effect.forkChild);
        yield* Deferred.await(firstScanStarted);
        yield* settingsService.updateSettings({
          usagePriceOverrides: {
            "example-model": { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
          },
        });
        const second = yield* service.readSummary(WINDOW).pipe(Effect.forkChild);
        yield* Deferred.await(secondScanStarted);
        yield* Deferred.succeed(releaseRates, undefined);

        const original = yield* Fiber.join(first);
        const updated = yield* Fiber.join(second);
        assert.strictEqual(original.buckets[0]?.costUsd, 0);
        assert.closeTo(updated.buckets[0]?.costUsd ?? -1, 0.00006, 1e-12);
      }).pipe(
        Effect.provide(serviceLayers({ prefix: "usage-service-price-race-test", home, settings })),
      );
    }).pipe(Effect.scoped),
  );

  it.live("answers a home with nothing to read without waiting on the rate table", () =>
    Effect.gen(function* () {
      const { settings, home } = yield* setup;
      yield* Effect.gen(function* () {
        // The rate fetch never answers: a window with no transcripts must not depend on it.
        const service = yield* UsageService.make.pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.never),
          ),
        );
        const summary = yield* service.readSummary(WINDOW).pipe(Effect.timeout(3_000));
        assert.strictEqual(summary.buckets.length, 0);
        assert.deepStrictEqual(summary.projects ?? [], []);
      }).pipe(
        Effect.provide(serviceLayers({ prefix: "usage-service-empty-home-test", home, settings })),
      );
    }).pipe(Effect.scoped),
  );

  it.live("shares one scan between concurrent identical requests", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      let ratesFetches = 0;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-service-flight-test",
            home,
            settings,
            onRatesFetch: () => {
              ratesFetches += 1;
            },
          }),
        ),
      );

      const [first, second] = yield* Effect.all(
        [service.readSummary(WINDOW), service.readSummary(WINDOW)],
        { concurrency: 2 },
      );
      assert.deepStrictEqual(first, second);
      assert.strictEqual(ratesFetches, 1);

      // A later request is fresh work again, not a stale cached answer.
      yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 2);
    }).pipe(Effect.scoped),
  );

  it.live("refetches a rate table inside its TTL only when the client asks", () =>
    Effect.gen(function* () {
      const { transcript, settings, home } = yield* setup;
      yield* Effect.promise(() => NodeFSP.writeFile(transcript, claudeLine(1, 5)));

      let ratesFetches = 0;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({
            prefix: "usage-service-rates-refresh-test",
            home,
            settings,
            ratesDocument: {
              "claude-fable-5": { input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
            },
            onRatesFetch: () => {
              ratesFetches += 1;
            },
          }),
        ),
      );

      const first = yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 1);
      assert.strictEqual(first.pricing.status, "fresh");

      // Inside the daily TTL a plain rescan keeps the cached table.
      yield* TestClock.adjust(Duration.minutes(2));
      yield* service.readSummary(WINDOW);
      assert.strictEqual(ratesFetches, 1);

      // An explicit refresh fetches again so a newly listed model gets priced.
      // A burst of refreshes shares that one fetch.
      const [refreshed] = yield* Effect.all([service.refreshRates, service.refreshRates], {
        concurrency: 2,
      });
      assert.strictEqual(ratesFetches, 2);
      assert.strictEqual(refreshed.status, "fresh");
      assert.strictEqual(refreshed.knownModels, 1);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
  );

  it.live("does not orphan an in-flight scan when its first caller is interrupted", () =>
    Effect.gen(function* () {
      const { settings, home } = yield* setup;
      const service = yield* UsageService.make.pipe(
        Effect.provide(
          serviceLayers({ prefix: "usage-service-interruption-test", home, settings }),
        ),
      );

      let orphanedAt: number | undefined;
      for (let interruptAt = 1; interruptAt <= 31; interruptAt += 1) {
        const tasks: Array<() => void> = [];
        const dispatcher: Scheduler.SchedulerDispatcher = {
          scheduleTask: (task) => tasks.push(task),
          flush: () => {
            let task: (() => void) | undefined;
            while ((task = tasks.shift()) !== undefined) task();
          },
        };

        let requestFiber: Fiber.Fiber<unknown, unknown> | undefined;
        let requestChecks = 0;
        const scheduler: Scheduler.Scheduler = {
          executionMode: "async",
          makeDispatcher: () => dispatcher,
          shouldYield: (fiber) => {
            if (fiber !== requestFiber) return false;
            requestChecks += 1;
            if (requestChecks !== interruptAt) return false;
            fiber.interruptUnsafe();
            return true;
          },
        };

        // Each candidate needs a distinct key because the broken case leaves
        // its entry in the service's private in-flight map. The invalid window
        // keeps the real scan synchronous once its detached fiber starts.
        const input: UsageSummaryInput = {
          ...WINDOW,
          sinceDay: UsageDay.make("2026-09-01"),
          untilDay: UsageDay.make(`2026-08-${String(interruptAt).padStart(2, "0")}`),
        };
        const first = yield* service
          .readSummary(input)
          .pipe(
            Effect.exit,
            Effect.provideService(Scheduler.Scheduler, scheduler),
            Effect.forkChild,
          );
        requestFiber = first;
        yield* Effect.yieldNow;
        dispatcher.flush();

        const second = yield* service.readSummary(input).pipe(
          Effect.match({
            onFailure: (error) => error.reason,
            onSuccess: () => "success" as const,
          }),
          Effect.provideService(Scheduler.Scheduler, scheduler),
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        dispatcher.flush();
        const secondExit = second.pollUnsafe();
        if (secondExit === undefined) {
          second.interruptUnsafe();
          orphanedAt = interruptAt;
          break;
        }
        if (Exit.isFailure(secondExit)) {
          assert.fail("the matching request fiber was interrupted");
        }
        assert.strictEqual(secondExit.value, "invalidWindow");
      }

      assert.isUndefined(
        orphanedAt,
        `interruption left the next matching request pending at scheduler check ${orphanedAt}`,
      );
    }).pipe(Effect.scoped),
  );

  it.live("counts OpenCode and Antigravity stores beside Claude transcripts", () =>
    Effect.gen(function* () {
      const { settings, home } = yield* setup;
      const opencodeDir = NodePath.join(home, ".local", "share", "opencode");
      const antigravityDir = NodePath.join(home, ".gemini", "antigravity", "conversations");
      yield* Effect.promise(() => NodeFSP.mkdir(opencodeDir, { recursive: true }));
      yield* Effect.promise(() => NodeFSP.mkdir(antigravityDir, { recursive: true }));
      yield* Effect.promise(async () => {
        const opencode = new NodeSqlite.DatabaseSync(NodePath.join(opencodeDir, "opencode.db"));
        opencode.exec(`
          CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
          CREATE TABLE message (id TEXT, data TEXT);
        `);
        opencode
          .prepare(
            "INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            "part-1",
            "msg-1",
            "ses_1",
            Date.parse("2026-08-01T10:00:00.000Z"),
            '{"type":"step-finish","tokens":{"input":10,"output":4,"reasoning":0,"cache":{"read":0,"write":0}},"cost":0}',
          );
        opencode
          .prepare("INSERT INTO message (id, data) VALUES (?, ?)")
          .run("msg-1", '{"modelID":"opencode-test"}');
        opencode.close();

        const conversation = new NodeSqlite.DatabaseSync(
          NodePath.join(antigravityDir, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.db"),
        );
        conversation.exec("CREATE TABLE steps (idx INTEGER, step_type INTEGER, metadata BLOB)");
        const seconds = Math.floor(Date.parse("2026-08-01T10:00:00.000Z") / 1000);
        const varint = (value: number) => {
          const bytes: number[] = [];
          let rest = value;
          while (rest > 127) {
            bytes.push((rest & 0x7f) | 0x80);
            rest = Math.floor(rest / 128);
          }
          bytes.push(rest & 0x7f);
          return Buffer.from(bytes);
        };
        const fieldVarint = (field: number, value: number) =>
          Buffer.concat([varint((field << 3) | 0), varint(value)]);
        const fieldBytes = (field: number, value: Buffer) =>
          Buffer.concat([varint((field << 3) | 2), varint(value.length), value]);
        conversation
          .prepare("INSERT INTO steps (idx, step_type, metadata) VALUES (?, ?, ?)")
          .run(
            1,
            15,
            Buffer.concat([
              fieldBytes(1, fieldVarint(1, seconds)),
              fieldBytes(9, Buffer.concat([fieldVarint(2, 12), fieldVarint(3, 3)])),
              fieldBytes(24, fieldBytes(8, Buffer.from("gemini-test"))),
            ]),
          );
        conversation.close();
      });

      const service = yield* UsageService.make.pipe(
        Effect.provide(serviceLayers({ prefix: "usage-service-sqlite-test", home, settings })),
      );
      const summary = yield* service.readSummary(WINDOW);
      const outputFor = (provider: string) =>
        summary.buckets
          .filter((bucket) => bucket.provider === provider)
          .reduce((sum, bucket) => sum + bucket.totals.outputTokens, 0);

      assert.strictEqual(outputFor("opencode"), 4);
      assert.strictEqual(outputFor("antigravity"), 3);
      const opencodeSource = summary.sources.find(
        (source) => source.fingerprint.provider === "opencode",
      );
      assert.strictEqual(opencodeSource?.status, "ok");
      assert.strictEqual(opencodeSource?.distinctSessions, 1);
    }).pipe(Effect.scoped),
  );
});
