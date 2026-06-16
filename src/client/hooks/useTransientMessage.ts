import { useCallback, useEffect, useRef, useState } from "react";

export default function useTransientMessage(timeoutMs = 3000) {
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMessage = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMessage("");
  }, []);

  const updateMessage = useCallback(
    (nextMessage: string) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setMessage(nextMessage);
      if (nextMessage) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setMessage("");
        }, timeoutMs);
      }
    },
    [timeoutMs],
  );

  useEffect(() => clearMessage, [clearMessage]);

  return [message, updateMessage, clearMessage] as const;
}
