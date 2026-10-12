/* agent-watermark: model=gpt-6.1-sol; effort=high; duration=10m; seat=codex; date=2026-10-03 */
/* agent-watermark: model=gemini-3.8-flash; effort=high; duration=10m; seat=antigravity; date=2026-10-02 */
import * as Haptics from "expo-haptics";
import {
  filterSavedPrompts,
  type PromptPresetCategory,
} from "@t3tools/client-runtime/promptPresets";
import { memo, useMemo, useState, useRef, useEffect } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import { useMobilePromptStash } from "./useMobilePromptStash";

export interface PromptStashModalProps {
  readonly visible: boolean;
  readonly onRequestClose: () => void;
  readonly currentDraft: string;
  readonly onSelectPrompt: (prompt: string, mode?: "append" | "replace") => void;
  readonly onDraftStashed?: (savedDraft: string) => void;
}

function formatStashTime(isoDate: string): string {
  try {
    const timestamp = Date.parse(isoDate);
    if (!Number.isFinite(timestamp)) return "recently";
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "recently";
  }
}

const CATEGORY_LABELS: Record<PromptPresetCategory, string> = {
  refactor: "Refactor",
  quality: "Quality & Tests",
  workflow: "Workflow",
  exploration: "Exploration",
};

export const PromptStashModal = memo(function PromptStashModal(props: PromptStashModalProps) {
  const { visible, onRequestClose, currentDraft, onSelectPrompt, onDraftStashed } = props;
  const insets = useSafeAreaInsets();
  const {
    stashedPrompts,
    stashCount,
    stashPrompt,
    deleteStash,
    curatedPresets,
    getFilteredPresets,
  } = useMobilePromptStash();

  const [activeTab, setActiveTab] = useState<"stash" | "presets">("stash");
  const [selectedCategory, setSelectedCategory] = useState<PromptPresetCategory | "all">("all");
  const [stashQuery, setStashQuery] = useState("");
  const filteredStashes = useMemo(
    () => filterSavedPrompts(stashedPrompts, stashQuery),
    [stashedPrompts, stashQuery],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [justStashed, setJustStashed] = useState(false);

  const canStashCurrentDraft = currentDraft.trim().length > 0;

  const filteredPresets = useMemo(() => {
    return getFilteredPresets({
      category: selectedCategory,
      query: searchQuery,
    });
  }, [getFilteredPresets, selectedCategory, searchQuery]);

  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = useRef(false);
  const currentDraftRef = useRef(currentDraft);
  const mounted = useRef(true);
  useEffect(() => {
    currentDraftRef.current = currentDraft;
  }, [currentDraft]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!justStashed) return;
    const timer = setTimeout(() => setJustStashed(false), 2000);
    return () => clearTimeout(timer);
  }, [justStashed]);

  const handleStashCurrentDraft = async () => {
    if (!canStashCurrentDraft || busy.current) return;
    const savedDraft = currentDraft;
    busy.current = true;
    setPendingAction("stash");
    setActionError(null);
    try {
      const saved = await stashPrompt(savedDraft);
      if (!saved || !mounted.current) return;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      setJustStashed(true);
      // A write receipt for an earlier draft must never clear newer composer text.
      if (currentDraftRef.current === savedDraft) onDraftStashed?.(savedDraft);
    } catch {
      if (mounted.current)
        setActionError(
          "Could not save the prompt. Your draft is still in the composer. Try again.",
        );
    } finally {
      busy.current = false;
      if (mounted.current) setPendingAction(null);
    }
  };

  const handleSelect = (prompt: string, mode: "append" | "replace" = "replace") => {
    if (busy.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onSelectPrompt(prompt, mode);
    onRequestClose();
  };

  const handleDeleteStash = async (id: string) => {
    if (busy.current) return;
    busy.current = true;
    setPendingAction(`delete:${id}`);
    setActionError(null);
    try {
      await deleteStash(id);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    } catch {
      if (mounted.current) setActionError("Could not delete the saved prompt. Try again.");
    } finally {
      busy.current = false;
      if (mounted.current) setPendingAction(null);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-end bg-black/50"
      >
        <Pressable
          className="flex-1"
          accessibilityLabel="Dismiss prompt modal"
          accessibilityRole="button"
          onPress={onRequestClose}
        />
        <View
          className="max-h-[85%] rounded-t-[28px] border-t border-border-subtle bg-sheet shadow-2xl"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {/* Grabber indicator */}
          <View className="items-center pt-3 pb-2">
            <View className="h-1.5 w-10 rounded-full bg-foreground/20" />
          </View>

          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pb-3">
            <View className="flex-row items-center gap-2">
              <SymbolView name="doc.text" size={18} tintColorClassName="accent-icon" />
              <Text className="text-lg font-t3-bold text-foreground">Prompts & Templates</Text>
            </View>
            <Pressable
              accessibilityLabel="Close prompt modal"
              accessibilityRole="button"
              className="size-8 items-center justify-center rounded-full bg-foreground/5 active:bg-foreground/10"
              onPress={onRequestClose}
            >
              <SymbolView name="xmark" size={14} tintColorClassName="accent-icon" />
            </Pressable>
          </View>

          {actionError && (
            <Text accessibilityRole="alert" className="px-5 pb-3 text-xs text-foreground-muted">
              {actionError}
            </Text>
          )}
          {/* Tab Switcher */}
          <View className="px-5 pb-3">
            <View className="h-10 flex-row rounded-full bg-foreground/5 p-1">
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === "stash" }}
                className={cn(
                  "flex-1 items-center justify-center rounded-full transition-all",
                  activeTab === "stash" ? "bg-card shadow-sm" : "",
                )}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setActiveTab("stash");
                }}
              >
                <Text
                  className={cn(
                    "text-xs font-t3-medium",
                    activeTab === "stash" ? "text-foreground" : "text-foreground-muted",
                  )}
                >
                  Saved Stash ({stashCount})
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === "presets" }}
                className={cn(
                  "flex-1 items-center justify-center rounded-full transition-all",
                  activeTab === "presets" ? "bg-card shadow-sm" : "",
                )}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setActiveTab("presets");
                }}
              >
                <Text
                  className={cn(
                    "text-xs font-t3-medium",
                    activeTab === "presets" ? "text-foreground" : "text-foreground-muted",
                  )}
                >
                  Curated Presets ({curatedPresets.length})
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Content Area */}
          <ScrollView
            className="flex-1 px-5"
            contentContainerClassName="gap-3 pb-6"
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {activeTab === "stash" ? (
              <>
                {/* Save Current Draft Banner */}
                {canStashCurrentDraft ? (
                  <View className="gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-3.5">
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <SymbolView name="doc.text" size={16} tintColorClassName="accent-primary" />
                        <Text className="text-xs font-t3-bold text-foreground">Current Draft</Text>
                      </View>
                      <Text className="text-[11px] text-foreground-muted tabular-nums">
                        {currentDraft.trim().length} chars
                      </Text>
                    </View>
                    <Text
                      numberOfLines={2}
                      className="text-xs text-foreground-muted leading-relaxed"
                    >
                      {currentDraft.trim()}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Stash current draft"
                      accessibilityState={{
                        disabled: justStashed || pendingAction !== null,
                        busy: pendingAction === "stash",
                      }}
                      disabled={justStashed || pendingAction !== null}
                      onPress={() => {
                        void handleStashCurrentDraft();
                      }}
                      className={cn(
                        "mt-1 h-9 flex-row items-center justify-center gap-1.5 rounded-xl transition-all",
                        justStashed ? "bg-emerald-600" : "bg-primary active:opacity-85",
                      )}
                    >
                      <SymbolView
                        name={justStashed ? "checkmark" : "plus"}
                        size={14}
                        tintColorClassName="accent-primary-foreground"
                      />
                      <Text className="text-xs font-t3-bold text-primary-foreground">
                        {pendingAction === "stash"
                          ? "Saving…"
                          : justStashed
                            ? "Saved to library"
                            : "Stash Current Draft"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                <View className="h-10 flex-row items-center rounded-xl bg-foreground/5 px-3">
                  <SymbolView
                    name="magnifyingglass"
                    size={14}
                    tintColorClassName="accent-icon-muted"
                  />
                  <TextInput
                    accessibilityLabel="Search saved prompts"
                    className="flex-1 pl-2 text-xs text-foreground"
                    placeholder="Search saved prompts…"
                    placeholderTextColor="rgba(128,128,128,0.6)"
                    value={stashQuery}
                    onChangeText={setStashQuery}
                    autoCorrect={false}
                  />
                  {stashQuery.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear saved prompt search"
                      onPress={() => setStashQuery("")}
                      className="px-2 py-2"
                    >
                      <Text className="text-xs text-foreground-muted">Clear</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text accessibilityLiveRegion="polite" className="text-xs text-foreground-muted">
                  {filteredStashes.length} of {stashedPrompts.length} saved prompts
                </Text>
                {/* Stash List */}
                {filteredStashes.length > 0 ? (
                  filteredStashes.map((item) => (
                    <View
                      key={item.id}
                      className="gap-2.5 rounded-2xl border border-border-subtle bg-card p-3.5 shadow-sm"
                    >
                      <View className="flex-row items-center justify-between">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-xs font-t3-medium text-foreground-muted">
                            {formatStashTime(item.createdAt)}
                          </Text>
                          <Text className="text-[11px] text-foreground-tertiary tabular-nums">
                            · {item.prompt.length} chars
                          </Text>
                        </View>
                        <Pressable
                          accessibilityLabel="Delete stashed prompt"
                          accessibilityRole="button"
                          disabled={pendingAction !== null}
                          accessibilityState={{
                            disabled: pendingAction !== null,
                            busy: pendingAction === `delete:${item.id}`,
                          }}
                          onPress={() => {
                            void handleDeleteStash(item.id);
                          }}
                          className="size-7 items-center justify-center rounded-lg active:bg-foreground/10"
                        >
                          <SymbolView
                            name="trash"
                            size={13}
                            tintColorClassName="accent-icon-muted"
                          />
                        </Pressable>
                      </View>

                      <Text
                        numberOfLines={3}
                        className="text-xs text-foreground leading-relaxed"
                        selectable
                      >
                        {item.prompt}
                      </Text>

                      <View className="flex-row items-center gap-2 pt-1">
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => handleSelect(item.prompt, "replace")}
                          className="h-8 flex-1 items-center justify-center rounded-xl bg-foreground/5 active:bg-foreground/10"
                        >
                          <Text className="text-xs font-t3-medium text-foreground">Use prompt</Text>
                        </Pressable>
                        {canStashCurrentDraft ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => handleSelect(item.prompt, "append")}
                            className="h-8 flex-1 items-center justify-center rounded-xl border border-border-subtle active:bg-foreground/5"
                          >
                            <Text className="text-xs font-t3-medium text-foreground-muted">
                              + Append
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ))
                ) : (
                  <View className="items-center justify-center py-12 gap-3">
                    <View className="size-14 items-center justify-center rounded-2xl bg-foreground/5">
                      <SymbolView
                        name="doc.text"
                        size={26}
                        tintColorClassName="accent-icon-muted"
                      />
                    </View>
                    <Text className="text-sm font-t3-medium text-foreground">
                      {stashedPrompts.length === 0 ? "No stashed prompts" : "No matching prompts"}
                    </Text>
                    <Text className="max-w-[260px] text-center text-xs text-foreground-muted leading-relaxed">
                      {stashedPrompts.length === 0
                        ? "Type ideas or drafts in the composer and stash them here to easily reuse across any thread."
                        : "Try fewer words or clear your search to see all saved prompts."}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <>
                {/* Search and Filters */}
                <View className="gap-2.5">
                  <View className="h-10 flex-row items-center rounded-xl bg-foreground/5 px-3">
                    <SymbolView
                      name="magnifyingglass"
                      size={14}
                      tintColorClassName="accent-icon-muted"
                    />
                    <TextInput
                      className="flex-1 pl-2 text-xs text-foreground"
                      accessibilityLabel="Search presets"
                      placeholder="Search presets…"
                      placeholderTextColor="rgba(128,128,128,0.6)"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      clearButtonMode="while-editing"
                    />
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="flex-row gap-1.5"
                  >
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setSelectedCategory("all");
                      }}
                      className={cn(
                        "rounded-full px-3 py-1.5",
                        selectedCategory === "all" ? "bg-foreground" : "bg-foreground/5",
                      )}
                    >
                      <Text
                        className={cn(
                          "text-xs font-t3-medium",
                          selectedCategory === "all" ? "text-background" : "text-foreground-muted",
                        )}
                      >
                        All
                      </Text>
                    </Pressable>
                    {(Object.keys(CATEGORY_LABELS) as PromptPresetCategory[]).map((cat) => (
                      <Pressable
                        key={cat}
                        accessibilityRole="button"
                        onPress={() => {
                          void Haptics.selectionAsync();
                          setSelectedCategory(cat);
                        }}
                        className={cn(
                          "rounded-full px-3 py-1.5",
                          selectedCategory === cat ? "bg-foreground" : "bg-foreground/5",
                        )}
                      >
                        <Text
                          className={cn(
                            "text-xs font-t3-medium",
                            selectedCategory === cat ? "text-background" : "text-foreground-muted",
                          )}
                        >
                          {CATEGORY_LABELS[cat]}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                {/* Presets List */}
                {filteredPresets.map((preset) => (
                  <Pressable
                    key={preset.id}
                    accessibilityRole="button"
                    onPress={() => handleSelect(preset.prompt, "replace")}
                    className="gap-2 rounded-2xl border border-border-subtle bg-card p-4 shadow-sm active:bg-foreground/5"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm font-t3-bold text-foreground">{preset.title}</Text>
                      <View className="rounded-full bg-foreground/10 px-2.5 py-0.5">
                        <Text className="text-[10px] font-t3-medium uppercase tracking-wider text-foreground-muted">
                          {preset.category}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-xs text-foreground-muted leading-relaxed">
                      {preset.description}
                    </Text>
                    <View className="rounded-xl bg-foreground/5 p-2.5">
                      <Text
                        numberOfLines={2}
                        className="text-[11px] text-foreground-tertiary leading-relaxed italic"
                      >
                        "{preset.prompt}"
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});
