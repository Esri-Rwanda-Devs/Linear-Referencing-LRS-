import { useEffect, useMemo, useRef, useState } from "react";

const MAX_SHOWN = 200;
const labelOf = (item) => (item.code && item.code !== item.id ? `${item.id} · ${item.code}` : item.id);
const squash = (text) => String(text).toLowerCase().replace(/[\s_-]+/g, "");

export default function RoutePicker({ catalog, value, onChange, placeholder = "Search routes…", emptyLabel = "", className = "", disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState(null);
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  const matches = useMemo(() => {
    const wanted = squash(query.trim());
    const found = wanted ? catalog.filter((item) => squash(item.id).includes(wanted) || squash(item.code || "").includes(wanted)) : catalog;
    return found.slice(0, MAX_SHOWN);
  }, [catalog, query]);
  const options = emptyLabel ? [{ id: "", label: emptyLabel }, ...matches] : matches;
  const selected = catalog.find((item) => item.id === value);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => { setActive(0); }, [query, open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 8;
      const up = below < 160 && rect.top > below;
      setPlace({
        left: rect.left,
        minWidth: rect.width,
        maxHeight: Math.max(120, Math.min(260, (up ? rect.top : below) - 6)),
        ...(up ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.bottom + 2 }),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && options[active]) choose(options[active].id);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className={`route-picker ${open ? "open" : ""} ${className}`} ref={boxRef}>
      <input
        ref={inputRef}
        value={open ? query : (selected ? labelOf(selected) : (value ? value : ""))}
        placeholder={selected ? labelOf(selected) : (emptyLabel || placeholder)}
        disabled={disabled}
        onFocus={() => { if (disabled) return; setOpen(true); setQuery(""); }}
        onChange={(event) => { if (disabled) return; setQuery(event.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      <span className="route-picker-caret" aria-hidden="true">▾</span>
      {open && (
        <ul className="route-picker-list" ref={listRef} role="listbox" style={place || undefined}>
          {options.map((item, index) => (
            <li
              key={item.id || "__empty"}
              data-index={index}
              role="option"
              aria-selected={item.id === value}
              className={`${index === active ? "active" : ""} ${item.id === value ? "selected" : ""}`}
              onPointerDown={(event) => { event.preventDefault(); choose(item.id); }}
              onPointerEnter={() => setActive(index)}
            >
              {item.label || labelOf(item)}
            </li>
          ))}
          {!matches.length && <li className="route-picker-none">No route matches “{query}”</li>}
          {matches.length === MAX_SHOWN && <li className="route-picker-none">Keep typing to narrow the list…</li>}
        </ul>
      )}
    </div>
  );
}
