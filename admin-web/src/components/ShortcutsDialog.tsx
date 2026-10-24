import { Modal } from "./Modal";
import { SHORTCUTS } from "../lib/navigation";

/** "?": the keyboard shortcuts of the dashboard. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      title="Tastaturkürzel"
      onClose={onClose}
      actions={
        <button type="button" className="button" onClick={onClose}>
          Schliessen
        </button>
      }
    >
      <table className="table">
        <thead>
          <tr>
            <th>Taste</th>
            <th>Wirkung</th>
            <th>Wo</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys + s.where}>
              <td>
                <kbd>{s.keys}</kbd>
              </td>
              <td>{s.text}</td>
              <td className="muted">{s.where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
