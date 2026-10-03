// 단축키: every keyboard shortcut in the app, grouped, each with its current
// combos (chips) — remove one with ×, record a new one with +, or reset to the
// defaults. Edits go to the draft like every other setting (applied on 저장).
// A combo already used by another action is moved, with a note saying where
// it was taken from.
import { useEffect, useState } from "react";
import type { JSX } from "react";
import SettingRow from "../SettingRow";
import { AddIcon, CloseIcon } from "../icons";
import { useSettings } from "./context";
import {
  SHORTCUTS,
  comboFromEvent,
  prettyCombo,
  shortcutCombos,
  type ShortcutId,
} from "../../../../shared/shortcuts";

const GROUPS = [...new Set(SHORTCUTS.map((s) => s.group))];

export default function ShortcutSection(): JSX.Element {
  const { draft, patch } = useSettings();
  const overrides = draft.shortcuts ?? {};
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const combosOf = (id: ShortcutId): string[] => shortcutCombos(overrides, id);
  const setCombos = (next: Partial<Record<string, string[]>>): void =>
    patch({ shortcuts: { ...overrides, ...next } });

  // While recording, the next key combo (with at least one non-modifier key)
  // is captured before any shortcut handler sees it. Esc cancels.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(null);
      const combo = comboFromEvent(e);
      if (!combo) return; // only a modifier so far — keep waiting
      const id = recording;
      const changes: Partial<Record<string, string[]>> = {};
      let takenFrom: string | null = null;
      for (const s of SHORTCUTS) {
        if (s.id === id) continue;
        const cur = combosOf(s.id);
        if (cur.includes(combo)) {
          changes[s.id] = cur.filter((c) => c !== combo);
          takenFrom = s.label;
        }
      }
      const mine = combosOf(id);
      changes[id] = mine.includes(combo) ? mine : [...mine, combo];
      setCombos(changes);
      setNote(
        takenFrom
          ? `${prettyCombo(combo)} — '${takenFrom}'에서 옮겨왔습니다.`
          : null,
      );
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, overrides]);

  const isDefault = (id: ShortcutId): boolean => overrides[id] === undefined;

  return (
    <>
      {GROUPS.map((group, gi) => (
        <section data-cat="keys" key={group}>
          <h2>{group}</h2>
          {gi === 0 && (
            <p className="hint">
              + 를 누른 뒤 원하는 키 조합을 누르면 추가됩니다 (Esc 취소). 다른
              기능에 쓰던 조합은 그 기능에서 빠지고 이쪽으로 옮겨집니다.
              저장해야 적용됩니다.
            </p>
          )}
          {gi === 0 && note && <p className="hint key-note">{note}</p>}
          {SHORTCUTS.filter((s) => s.group === group).map((s) => {
            const combos = combosOf(s.id);
            return (
              <SettingRow key={s.id} title={s.label}>
                <div className="key-combos">
                  {combos.length === 0 && (
                    <span className="key-none">없음</span>
                  )}
                  {combos.map((c) => (
                    <span key={c} className="key-chip">
                      <kbd>{prettyCombo(c)}</kbd>
                      <span
                        className="key-x"
                        title="이 조합 삭제"
                        onClick={() =>
                          setCombos({ [s.id]: combos.filter((x) => x !== c) })
                        }
                      >
                        <CloseIcon />
                      </span>
                    </span>
                  ))}
                  <span className="flat-group">
                    <button
                      className={`mini icon key-add ${recording === s.id ? "on" : ""}`}
                      title={
                        recording === s.id
                          ? "키 조합을 누르세요 (Esc 취소)"
                          : "단축키 추가"
                      }
                      onClick={() =>
                        setRecording(recording === s.id ? null : s.id)
                      }
                    >
                      {recording === s.id ? (
                        <span className="key-wait">키 입력…</span>
                      ) : (
                        <AddIcon />
                      )}
                    </button>
                    <button
                      className="mini"
                      disabled={isDefault(s.id)}
                      title="기본 단축키로 되돌리기"
                      onClick={() => {
                        const next = { ...overrides };
                        delete next[s.id];
                        patch({ shortcuts: next });
                      }}
                    >
                      기본값
                    </button>
                  </span>
                </div>
              </SettingRow>
            );
          })}
        </section>
      ))}
    </>
  );
}
