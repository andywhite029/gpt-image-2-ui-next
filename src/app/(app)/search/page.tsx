"use client";

// 搜索页：?q= + 筛选 bar + 分类型分组结果
// useSearchParams 需要 Suspense 包裹（App Router 静态导出要求）

import { Suspense } from "react";
import { SearchContent } from "./search-content";

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="loading"><span className="spinner" /><span>加载搜索…</span></div>}>
      <SearchContent />
    </Suspense>
  );
}
