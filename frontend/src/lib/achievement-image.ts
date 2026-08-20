/**
 * Shared by the achievement create form (achievements list page) and the
 * achievement edit form ([id] page): the accepted image types, the max
 * upload size, and the fixed preview thumbnail class both forms render at.
 */
export const ACHIEVEMENT_IMAGE_ACCEPT = "image/webp,image/png,image/jpeg,image/gif";
export const MAX_ACHIEVEMENT_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ACHIEVEMENT_IMAGE_PREVIEW_CLASS = "h-16 w-16 rounded-lg object-cover border";
