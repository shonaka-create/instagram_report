"use client";

import { useEffect } from "react";

// /reports/{token}?print=1 で開かれたとき、描画後に印刷ダイアログを自動で出す
// (一覧の「PDF」リンク用。ブラウザ印刷=Chromium品質のPDF保存)
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);
  return null;
}
