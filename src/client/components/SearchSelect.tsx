import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

interface Option {
  id: string;
  label: string;
}

interface SearchSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  emptyText?: string;
  required?: boolean;
}

export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "搜索或选择...",
  "aria-label": ariaLabel,
  emptyText = "无匹配选项",
  required = false,
}: SearchSelectProps) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedOption = useMemo(
    () => options.find((option) => option.id === value),
    [options, value],
  );

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (open) {
      setActiveIndex(-1);
      setQuery(selectedOption ? selectedOption.label : "");
    }
  }, [open, selectedOption]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
        if (selectedOption) {
          setQuery(selectedOption.label);
        } else {
          setQuery("");
        }
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, selectedOption]);

  function selectOption(option: Option) {
    onChange(option.id);
    setQuery(option.label);
    setOpen(false);
    inputRef.current?.blur();
  }

  function clearSelection(event: React.MouseEvent) {
    event.stopPropagation();
    onChange("");
    setQuery("");
    setOpen(true);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (!open) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        current < filteredOptions.length - 1 ? current + 1 : current,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current > 0 ? current - 1 : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && filteredOptions[activeIndex]) {
        selectOption(filteredOptions[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      if (selectedOption) {
        setQuery(selectedOption.label);
      } else {
        setQuery("");
      }
    }
  }

  function highlightMatch(text: string): ReactNode {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return text;
    const index = text.toLowerCase().indexOf(normalized);
    if (index < 0) return text;
    return (
      <>
        {text.slice(0, index)}
        <mark className="search-highlight">{text.slice(index, index + normalized.length)}</mark>
        {text.slice(index + normalized.length)}
      </>
    );
  }

  return (
    <div ref={wrapRef} className="search-select">
      <div className="search-select-input-wrap">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          className="search-select-input"
          value={open ? query : selectedOption ? selectedOption.label : ""}
          placeholder={placeholder}
          required={required}
          onFocus={() => {
            setOpen(true);
            setQuery(selectedOption ? selectedOption.label : "");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {value ? (
          <button type="button" className="search-select-clear" aria-label="清空" onClick={clearSelection}>
            ×
          </button>
        ) : null}
        <span className="search-select-arrow" aria-hidden="true">▾</span>
      </div>
      {open ? (
        <ul id={listId} className="search-select-list" role="listbox" aria-label={ariaLabel}>
          {filteredOptions.length === 0 ? (
            <li className="search-select-empty" role="option">{emptyText}</li>
          ) : (
            filteredOptions.map((option, index) => (
              <li
                key={option.id}
                className={["search-select-option", activeIndex === index ? "active" : "", value === option.id ? "selected" : ""].join(" ")}
                role="option"
                aria-selected={value === option.id}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
              >
                {highlightMatch(option.label)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export type { Option };
