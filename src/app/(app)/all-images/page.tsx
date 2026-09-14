"use client";

// 全部图片（跨项目）

import { GalleryPage } from "@/components/gallery/gallery-page";

export default function AllImagesPage() {
  return (
    <GalleryPage
      title="全部图片"
      filters={{}}
      emptyText="还没有图片，去项目里发起一次生成吧"
    />
  );
}
