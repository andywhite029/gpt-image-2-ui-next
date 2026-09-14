"use client";

// 未分类（跨项目）

import { GalleryPage } from "@/components/gallery/gallery-page";

export default function UncategorizedPage() {
  return (
    <GalleryPage
      title="🗂 未分类"
      filters={{ uncategorized: true }}
      emptyText="没有未分类的图片"
    />
  );
}
