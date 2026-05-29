import { useState } from "react";

export default function ImageThumb({ src, alt }: { src: string | null | undefined; alt: string }) {
  const [open, setOpen] = useState(false);
  if (!src) {
    return <span className="empty-image">无图</span>;
  }

  return (
    <>
      <button className="image-thumb" type="button" onClick={() => setOpen(true)} title="点击查看大图">
        <img src={src} alt={alt} />
      </button>
      {open ? (
        <div className="image-modal" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <img src={src} alt={alt} onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}
