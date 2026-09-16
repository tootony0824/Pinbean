export const PUBLISH_REVIEW_FORMAT_VERSION = 1;
export const MAX_PUBLISH_TOPIC_LENGTH = 40;
export const MAX_PUBLISH_REVIEW_NOTE_LENGTH = 80;

export interface PublishReview {
  comments: number;
  conversions: number;
  favorites: number;
  formatVersion: typeof PUBLISH_REVIEW_FORMAT_VERSION;
  likes: number;
  note: string;
  publishedAt: number;
  topic: string;
  updatedAt: number;
}
export interface PublishReviewInput {
  comments?: number;
  conversions?: number;
  favorites?: number;
  likes?: number;
  note?: string;
  publishedAt: number;
  topic: string;
  updatedAt: number;
}
function integer(value: unknown, label: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new RangeError(`${label} must be a ${minimum ? 'positive' : 'non-negative'} safe integer`);
}
function text(value: unknown, label: string, maximum: number, required: boolean): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const result = value.trim();
  if (required && !result) throw new RangeError(`${label} is required`);
  if (result.length > maximum) throw new RangeError(`${label} is too long`);
  return result;
}
export function createPublishReview(input: PublishReviewInput): PublishReview {
  const topic = text(input.topic, 'publish topic', MAX_PUBLISH_TOPIC_LENGTH, true);
  const note = text(input.note ?? '', 'publish review note', MAX_PUBLISH_REVIEW_NOTE_LENGTH, false);
  const likes = input.likes ?? 0;
  const favorites = input.favorites ?? 0;
  const comments = input.comments ?? 0;
  const conversions = input.conversions ?? 0;
  integer(likes, 'likes'); integer(favorites, 'favorites'); integer(comments, 'comments'); integer(conversions, 'conversions');
  integer(input.publishedAt, 'published at', 1); integer(input.updatedAt, 'updated at', 1);
  if (input.updatedAt < input.publishedAt) throw new RangeError('updated at cannot be earlier than published at');
  return { comments, conversions, favorites, formatVersion: PUBLISH_REVIEW_FORMAT_VERSION, likes, note, publishedAt: input.publishedAt, topic, updatedAt: input.updatedAt };
}
export function restorePublishReview(input: unknown): PublishReview {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('publish review must be an object');
  const stored = input as Record<string, unknown>;
  if (stored.formatVersion !== PUBLISH_REVIEW_FORMAT_VERSION) throw new Error(`unsupported publish review format: ${String(stored.formatVersion)}`);
  return createPublishReview(stored as unknown as PublishReviewInput);
}
export function formatPublishReviewMetrics(review: PublishReview): string {
  const restored = restorePublishReview(review);
  return `赞 ${restored.likes} · 藏 ${restored.favorites} · 评 ${restored.comments} · 转化 ${restored.conversions}`;
}
export function formatPublishReviewTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new RangeError('publish review timestamp is invalid');
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function buildPublishReviewSummary(projectName: string, review: PublishReview): string {
  const restored = restorePublishReview(review);
  return [
    `PinBean 发布复盘｜${projectName.trim() || restored.topic}`,
    `主题：${restored.topic}`,
    `发布时间：${formatPublishReviewTime(restored.publishedAt)}`,
    `互动数据：${formatPublishReviewMetrics(restored)}`,
    restored.note ? `复盘备注：${restored.note}` : '',
  ].filter(Boolean).join('\n');
}
