import type { ReactNode } from "react";

export default function FormDialog({
  title,
  onClose,
  children,
  size = "default",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "default" | "large";
}) {
  return (
    <div className="dialog-mask" role="presentation">
      <section className={size === "large" ? "form-dialog form-dialog-large" : "form-dialog"} role="dialog" aria-modal="true" aria-label={title}>
        <header className="form-dialog-header">
          <h3>{title}</h3>
          <button className="dialog-close" type="button" aria-label="关闭" onClick={onClose}>
            x
          </button>
        </header>
        <div className="form-dialog-body">
          {children}
        </div>
      </section>
    </div>
  );
}
