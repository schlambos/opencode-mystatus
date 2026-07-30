import { useState, type JSX } from "react";
import { PROVIDERS } from "../../../shared/providers.js";
import { FieldLabel } from "./fields";

interface ProviderCheckboxesProps {
  disabled: readonly string[];
  onToggle: (id: string) => void;
}

export function ProviderCheckboxes({ disabled, onToggle }: ProviderCheckboxesProps): JSX.Element {
  const unknownIds = disabled.filter((id) => !PROVIDERS.some((provider) => provider.id === id));
  const enabledCount = PROVIDERS.length - disabled.filter((id) => PROVIDERS.some((p) => p.id === id)).length;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <FieldLabel label="Enabled providers" />
        <span data-testid="providers-enabled-count" className="font-mono text-[11px] text-fog-500 tabular-nums">
          {enabledCount}/{PROVIDERS.length} enabled
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
        {PROVIDERS.map((provider) => {
          const enabled = !disabled.includes(provider.id);
          return (
            <label
              key={provider.id}
              className="group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-800/70"
            >
              <input
                type="checkbox"
                data-testid={`provider-toggle-${provider.id}`}
                checked={enabled}
                onChange={() => onToggle(provider.id)}
                className="h-3.5 w-3.5 shrink-0 appearance-none rounded-[4px] border transition-colors duration-150 checked:border-accent checked:bg-accent group-hover:border-ink-600 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
              />
              <span
                className={`text-xs transition-colors duration-150 ${
                  enabled ? "text-fog-200" : "text-fog-500 line-through decoration-fog-600"
                }`}
              >
                {provider.title}
              </span>
              <span className="ml-auto font-mono text-[10px] text-fog-600">{provider.id}</span>
            </label>
          );
        })}
      </div>
      {unknownIds.length > 0 && (
        <p data-testid="providers-unknown-note" className="mt-2 text-[11px] text-fog-500">
          Unknown ids preserved from the file: <span className="font-mono">{unknownIds.join(", ")}</span>
        </p>
      )}
      <p className="mt-2 text-[11px] text-fog-600">
        Disabled providers are never queried. Hiding (from the dashboard) is separate — hidden providers
        still sync in the background.
      </p>
    </div>
  );
}

interface OrderEditorProps {
  order: readonly string[];
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onAdd: (id: string) => void;
}

export function OrderEditor({ order, onMove, onRemove, onAdd }: OrderEditorProps): JSX.Element {
  const [candidate, setCandidate] = useState("");
  const remaining = PROVIDERS.filter((provider) => !order.includes(provider.id));

  return (
    <div>
      <FieldLabel label="Preferred order" />
      {order.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-fog-600">No custom order — the sort mode decides.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {order.map((id, index) => (
            <li
              key={id}
              data-testid={`order-item-${id}`}
              className="flex items-center gap-2 rounded-md border border-ink-700/70 bg-ink-950/50 px-2 py-1"
            >
              <span className="w-4 font-mono text-[10px] text-fog-600 tabular-nums">{index + 1}</span>
              <span className="font-mono text-xs text-fog-200">{id}</span>
              <span className="ml-auto flex items-center gap-1">
                <OrderButton label={`Move ${id} up`} testId={`order-up-${id}`} disabled={index === 0} onClick={() => onMove(id, -1)}>
                  ↑
                </OrderButton>
                <OrderButton
                  label={`Move ${id} down`}
                  testId={`order-down-${id}`}
                  disabled={index === order.length - 1}
                  onClick={() => onMove(id, 1)}
                >
                  ↓
                </OrderButton>
                <OrderButton label={`Remove ${id} from order`} testId={`order-remove-${id}`} onClick={() => onRemove(id)}>
                  ×
                </OrderButton>
              </span>
            </li>
          ))}
        </ol>
      )}
      {remaining.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <select
            aria-label="Provider to add to order"
            data-testid="order-candidate"
            value={candidate}
            onChange={(event) => setCandidate(event.target.value)}
            className="rounded-md border border-ink-700 bg-ink-950/70 px-2 py-1 font-mono text-xs text-fog-200 transition-colors duration-150 hover:border-ink-600 focus:border-accent focus:outline-none"
          >
            <option value="">add a provider…</option>
            {remaining.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="order-add"
            disabled={candidate === ""}
            onClick={() => {
              if (candidate !== "") {
                onAdd(candidate);
                setCandidate("");
              }
            }}
            className="rounded-md border border-ink-700 bg-ink-950/70 px-2.5 py-1 text-xs text-fog-300 transition-colors duration-150 hover:border-ink-600 hover:text-fog-100 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] text-fog-600">
        Listed providers pin to the top in this order; everyone else follows the sort mode.
      </p>
    </div>
  );
}

interface OrderButtonProps {
  label: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}

function OrderButton({ label, testId, disabled = false, onClick, children }: OrderButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="h-6 w-6 rounded border border-ink-700 bg-ink-900 text-xs text-fog-400 transition-colors duration-150 hover:border-ink-600 hover:text-fog-100 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

interface EmailListEditorProps {
  emails: readonly string[];
  onChange: (emails: string[]) => void;
}

export function EmailListEditor({ emails, onChange }: EmailListEditorProps): JSX.Element {
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  function add(): void {
    if (trimmed === "" || emails.includes(trimmed)) return;
    onChange([...emails, trimmed]);
    setValue("");
  }

  return (
    <div>
      <FieldLabel label="Excluded Google accounts" htmlFor="email-input" />
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id="email-input"
          type="text"
          data-testid="email-input"
          value={value}
          placeholder="account@gmail.com"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className="w-full max-w-sm rounded-md border border-ink-700 bg-ink-950/70 px-2.5 py-1.5 font-mono text-xs text-fog-100 transition-colors duration-150 placeholder:text-fog-600 hover:border-ink-600 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        />
        <button
          type="button"
          data-testid="email-add"
          onClick={add}
          disabled={trimmed === ""}
          className="rounded-md border border-ink-700 bg-ink-950/70 px-2.5 py-1.5 text-xs text-fog-300 transition-colors duration-150 hover:border-ink-600 hover:text-fog-100 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {emails.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {emails.map((email) => (
            <li
              key={email}
              data-testid="email-chip"
              className="flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-950/60 py-0.5 pr-1 pl-2.5 font-mono text-[11px] text-fog-300"
            >
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                data-testid={`email-remove-${email}`}
                onClick={() => onChange(emails.filter((entry) => entry !== email))}
                className="rounded-full px-1 text-fog-500 transition-colors duration-150 hover:text-status-low focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-fog-600">
        Matching accounts are skipped when rendering Google quota cards.
      </p>
    </div>
  );
}
