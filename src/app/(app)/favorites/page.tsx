"use client";

// 收藏（跨项目）

import { GalleryPage } from "@/components/gallery/gallery-page";

export default function FavoritesPage() {
  return (
    <GalleryPage
      title="⭐ 收藏"
      filters={{ favorites: true }}
      emptyText="还没有收藏任何图片"
    />
  );
}
