/** Native, accessible prompt for actions that accept one line of text. */

import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type {
  RemoteAppAction,
  RemoteAppActionTextInput,
} from "../lib/agent";

export type RemoteTextInputAction = RemoteAppAction & {
  input: RemoteAppActionTextInput;
};

interface ActionInputModalProps {
  action: RemoteTextInputAction | null;
  value: string;
  onCancel(): void;
  onChange(value: string): void;
  onSubmit(): void;
}

/** Collects one bounded line without sending anything until explicit submission. */
export default function ActionInputModal({
  action,
  value,
  onCancel,
  onChange,
  onSubmit,
}: ActionInputModalProps) {
  const input = action?.input;
  const valid = input !== undefined && (!input.required || value.trim() !== "");
  const blankError = input?.required === true && value !== "" && value.trim() === "";

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
      transparent
      visible={action !== null}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.backdrop}
      >
        <View accessibilityViewIsModal style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {action?.label ?? "Action input"}
          </Text>
          <Text nativeID="action-input-label" style={styles.label}>
            {input?.label ?? "Text"}
          </Text>
          <TextInput
            accessibilityHint={`Enter text for ${action?.label ?? "this action"}`}
            accessibilityLabel={input?.label ?? "Action input"}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            maxLength={input?.maxLength}
            onChangeText={onChange}
            onSubmitEditing={() => {
              if (valid) {
                onSubmit();
              }
            }}
            placeholder={input?.placeholder}
            placeholderTextColor="#64748b"
            returnKeyType="done"
            spellCheck={false}
            style={styles.input}
            value={value}
          />
          <View style={styles.inputMeta}>
            <Text accessibilityLiveRegion="polite" style={styles.validation}>
              {blankError ? `${input.label} must not be blank.` : ""}
            </Text>
            <Text style={styles.counter}>
              {value.length}/{input?.maxLength ?? 0}
            </Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Cancel"
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [
                styles.modalButton,
                styles.cancelButton,
                pressed && styles.modalButtonPressed,
              ]}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={action?.label ?? "Submit"}
              accessibilityRole="button"
              accessibilityState={{ disabled: !valid }}
              disabled={!valid}
              onPress={onSubmit}
              style={({ pressed }) => [
                styles.modalButton,
                styles.submitButton,
                !valid && styles.submitButtonDisabled,
                pressed && valid && styles.modalButtonPressed,
              ]}
            >
              <Text style={styles.submitButtonText}>{action?.label ?? "Submit"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2, 6, 23, 0.82)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    gap: 12,
    borderRadius: 16,
    backgroundColor: "#0f172a",
    padding: 20,
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "800",
  },
  label: {
    color: "#cbd5e1",
    fontSize: 15,
    fontWeight: "700",
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#38bdf8",
    borderRadius: 10,
    backgroundColor: "#020617",
    color: "#f8fafc",
    fontSize: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  inputMeta: {
    minHeight: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  validation: {
    flex: 1,
    color: "#fecaca",
    fontSize: 13,
  },
  counter: {
    color: "#94a3b8",
    fontSize: 13,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalButton: {
    minWidth: 112,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 18,
  },
  cancelButton: {
    backgroundColor: "#334155",
  },
  cancelButtonText: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
  },
  submitButton: {
    backgroundColor: "#0284c7",
  },
  submitButtonDisabled: {
    backgroundColor: "#334155",
    opacity: 0.65,
  },
  submitButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  modalButtonPressed: {
    opacity: 0.8,
  },
});
