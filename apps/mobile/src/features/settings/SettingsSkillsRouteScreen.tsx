import {
  displayedSkillCount,
  fetchEnvironmentSkillInventory,
  filterSkillInventory,
  formatSkillCount,
  formatSkillPath,
  groupSkillsByHarness,
  skillContentForDisplay,
  skillKey,
} from "@t3tools/client-runtime/state/skills";
import type { SkillInventory, SkillInventoryInstallation } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import * as Option from "effect/Option";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { runtime } from "../../lib/runtime";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import type { EnvironmentPresentation } from "../../state/environments";
import { useEnvironments } from "../../state/environments";
import { usePreparedConnection } from "../../state/session";

type InventoryState =
  | { readonly requestKey: string; readonly status: "loading" }
  | { readonly requestKey: string; readonly status: "loaded"; readonly inventory: SkillInventory }
  | { readonly requestKey: string; readonly status: "error"; readonly message: string };

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : "Could not inspect skills on this environment.";
}

function connectionDotClassName(phase: EnvironmentPresentation["connection"]["phase"]): string {
  if (phase === "connected") return "bg-success";
  if (phase === "connecting" || phase === "reconnecting") return "bg-warning";
  if (phase === "error") return "bg-danger";
  return "bg-foreground-muted/45";
}

export function SettingsSkillsRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const [query, setQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader
            title="Skills"
            onBack={() => navigation.goBack()}
            actions={[
              {
                accessibilityLabel: "Refresh skills",
                icon: "arrow.clockwise",
                onPress: refresh,
              },
            ]}
          />
        </>
      ) : (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            accessibilityLabel="Refresh skills"
            icon="arrow.clockwise"
            onPress={refresh}
            separateBackground
          />
        </NativeHeaderToolbar>
      )}

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <View className="gap-3">
          <Text className="text-sm leading-normal text-foreground-muted">
            Global skills discovered across supported agent harnesses on each connected computer.
          </Text>
          <TextInput
            accessibilityLabel="Search skills"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder="Search skills, harnesses, or paths"
            returnKeyType="search"
            value={query}
          />
        </View>

        {environments.length === 0 ? (
          <View className="items-center gap-3 rounded-[24px] bg-card px-6 py-8">
            <View className="h-12 w-12 items-center justify-center rounded-[16px] bg-subtle">
              <SymbolView
                name={{ ios: "sparkles", android: "auto_awesome" }}
                size={20}
                tintColorClassName="accent-icon-muted"
                type="monochrome"
              />
            </View>
            <Text className="text-center text-sm leading-normal text-foreground-muted">
              Connect an environment to inspect its installed skills.
            </Text>
          </View>
        ) : (
          environments.map((environment) => (
            <EnvironmentSkillInventory
              key={environment.environmentId}
              environment={environment}
              query={query}
              refreshKey={refreshKey}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function EnvironmentSkillInventory(props: {
  readonly environment: EnvironmentPresentation;
  readonly query: string;
  readonly refreshKey: number;
}) {
  const prepared = usePreparedConnection(props.environment.environmentId);
  const preparedValue = Option.getOrNull(prepared);
  const [retryKey, setRetryKey] = useState(0);
  const requestKey = `${preparedValue?.httpBaseUrl ?? "disconnected"}:${props.refreshKey}:${retryKey}`;
  const [loadedState, setLoadedState] = useState<InventoryState>({
    requestKey: "initial",
    status: "loading",
  });
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (preparedValue === null) return;
    let cancelled = false;
    void runtime
      .runPromise(fetchEnvironmentSkillInventory({ prepared: preparedValue }))
      .then((inventory) => {
        if (!cancelled) setLoadedState({ requestKey, status: "loaded", inventory });
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setLoadedState({ requestKey, status: "error", message: errorMessage(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [preparedValue, requestKey]);

  const state: InventoryState =
    loadedState.requestKey === requestKey ? loadedState : { requestKey, status: "loading" };
  const visibleInventory = useMemo(
    () => (state.status === "loaded" ? filterSkillInventory(state.inventory, props.query) : null),
    [props.query, state],
  );
  const isConnected = Option.isSome(prepared);
  const total = displayedSkillCount(
    state.status === "loaded" ? state.inventory : null,
    isConnected,
  );
  const visible = displayedSkillCount(visibleInventory, isConnected);
  const isSearching = props.query.trim().length > 0;
  const open = isSearching || !collapsed;

  return (
    <View className="overflow-hidden rounded-[24px] bg-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          if (!isSearching) setCollapsed((value) => !value);
        }}
        className="flex-row items-center gap-3 px-4 py-3.5 active:bg-subtle"
      >
        <SymbolView
          name={open ? "chevron.down" : "chevron.right"}
          size={14}
          tintColorClassName="accent-chevron"
          type="monochrome"
          weight="semibold"
        />
        <Text className="min-w-0 flex-1 text-base font-t3-medium" numberOfLines={1}>
          {props.environment.label}
        </Text>
        <View
          accessibilityLabel={`Connection ${props.environment.connection.phase}`}
          className={cn(
            "h-2 w-2 rounded-full",
            connectionDotClassName(props.environment.connection.phase),
          )}
        />
        {total !== null ? (
          <Text className="font-mono text-xs tabular-nums text-foreground-muted">
            {formatSkillCount(total, isSearching ? (visible ?? 0) : undefined)}
          </Text>
        ) : null}
      </Pressable>

      {open ? (
        <View className="border-t border-border">
          {preparedValue === null ? (
            <StatusLine>Connect to this computer to inspect its skills.</StatusLine>
          ) : state.status === "loading" ? (
            <StatusLine>Scanning skills…</StatusLine>
          ) : state.status === "error" ? (
            <View className="items-start gap-2 px-4 py-4">
              <Text className="text-sm leading-normal text-danger">{state.message}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRetryKey((value) => value + 1)}
                className="rounded-full bg-subtle px-3 py-1.5 active:opacity-60"
              >
                <Text className="text-sm font-t3-medium">Try again</Text>
              </Pressable>
            </View>
          ) : visibleInventory?.installations.length === 0 ? (
            <StatusLine>
              {props.query ? "No skills match this search." : "No global agent skills found."}
            </StatusLine>
          ) : visibleInventory ? (
            <SkillHarnessGroups inventory={visibleInventory} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function StatusLine({ children }: { readonly children: string }) {
  return <Text className="px-4 py-5 text-sm text-foreground-muted">{children}</Text>;
}

function SkillHarnessGroups({ inventory }: { readonly inventory: SkillInventory }) {
  const [expandedSkillKey, setExpandedSkillKey] = useState<string | null>(null);
  return groupSkillsByHarness(inventory.installations).map((group, groupIndex) => (
    <View key={group.key} className={cn(groupIndex !== 0 && "border-t border-border")}>
      <View className="flex-row items-center gap-2 bg-subtle/45 px-4 py-2.5">
        <SymbolView
          name={{ ios: "cpu", android: "memory" }}
          size={14}
          tintColorClassName="accent-icon-muted"
          type="monochrome"
        />
        <Text className="text-xs font-t3-bold uppercase tracking-wider text-foreground-muted">
          {group.harnessDisplayName}
        </Text>
        <Text className="font-mono text-xs tabular-nums text-foreground-muted">
          {group.skills.length}
        </Text>
        {group.rootPath ? (
          <Text
            className="min-w-0 flex-1 text-right font-mono text-xs text-foreground-faint"
            ellipsizeMode="middle"
            numberOfLines={1}
          >
            {formatSkillPath(group.rootPath)}
          </Text>
        ) : null}
      </View>
      {group.skills.map((skill, index) => {
        const key = skillKey(skill);
        return (
          <SkillRow
            key={key}
            skill={skill}
            bordered={index !== 0}
            open={expandedSkillKey === key}
            onToggle={() => setExpandedSkillKey((current) => (current === key ? null : key))}
          />
        );
      })}
    </View>
  ));
}

function SkillRow(props: {
  readonly skill: SkillInventoryInstallation;
  readonly bordered: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <View className={cn(props.bordered && "border-t border-border")}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.open }}
        onPress={props.onToggle}
        className="flex-row items-center gap-3 px-4 py-3 active:bg-subtle"
      >
        <SymbolView
          name={props.open ? "chevron.down" : "chevron.right"}
          size={13}
          tintColorClassName="accent-chevron"
          type="monochrome"
          weight="semibold"
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-[15px] font-t3-medium" numberOfLines={1}>
            {props.skill.name}
          </Text>
          {props.skill.description ? (
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              {props.skill.description}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {props.open ? <SkillDetail skill={props.skill} /> : null}
    </View>
  );
}

function SkillDetail({ skill }: { readonly skill: SkillInventoryInstallation }) {
  const content = skillContentForDisplay(skill.content);
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    },
    [],
  );

  return (
    <View className="mx-4 mb-4 gap-4 rounded-[18px] bg-subtle p-4">
      <Text className="text-sm leading-6 text-foreground-muted">
        {skill.description ?? "No description in this skill's frontmatter."}
      </Text>

      <View className="gap-1.5">
        <Text className="text-xs font-t3-bold uppercase tracking-wider text-foreground-faint">
          Installed at
        </Text>
        <View className="flex-row items-center gap-2">
          <Text
            className="min-w-0 flex-1 font-mono text-xs leading-5 text-foreground-muted"
            selectable
          >
            {skill.directoryPath}
          </Text>
          <Pressable
            accessibilityLabel={copied ? "Copied" : `Copy path for ${skill.name}`}
            accessibilityRole="button"
            onPress={() => {
              copyTextWithHaptic(skill.directoryPath, { target: "skill path" });
              setCopied(true);
              if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
              resetTimeoutRef.current = setTimeout(() => {
                setCopied(false);
                resetTimeoutRef.current = null;
              }, 1_200);
            }}
            className="h-8 flex-row items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 active:opacity-60"
          >
            <SymbolView
              name={
                copied
                  ? { ios: "checkmark", android: "check" }
                  : { ios: "doc.on.doc", android: "content_copy" }
              }
              size={12}
              tintColorClassName={copied ? "accent-success" : "accent-icon-muted"}
              type="monochrome"
            />
            <Text className={cn("text-xs font-t3-medium", copied && "text-success")}>
              {copied ? "Copied" : "Copy"}
            </Text>
          </Pressable>
        </View>
      </View>

      <View className="overflow-hidden rounded-[14px] border border-border bg-sheet">
        <View className="flex-row items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <Text className="text-xs font-t3-bold uppercase tracking-wider text-foreground-muted">
            SKILL.md
          </Text>
          <Text
            className="min-w-0 flex-1 text-right font-mono text-xs text-foreground-faint"
            ellipsizeMode="middle"
            numberOfLines={1}
          >
            {formatSkillPath(skill.skillFilePath)}
          </Text>
        </View>
        <Text className="p-3 font-mono text-xs leading-5 text-foreground-muted" selectable>
          {content ?? "This SKILL.md file is empty."}
        </Text>
      </View>
    </View>
  );
}
