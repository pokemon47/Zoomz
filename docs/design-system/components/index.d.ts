import type * as React from 'react';
type LOD = 'far' | 'medium' | 'close';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'cobalt' | 'ghost'; size?: 'md' | 'sm' }
export declare function Button(p: ButtonProps): React.ReactElement;
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { label: string }
export declare function IconButton(p: IconButtonProps): React.ReactElement;
export interface ZoomControlsProps { zoom: number; onZoomIn?(): void; onZoomOut?(): void; onFit?(): void }
export declare function ZoomControls(p: ZoomControlsProps): React.ReactElement;
export interface Crumb { id: string; title: string }
export interface BreadcrumbsProps { path: Crumb[]; onNavigate?(c: Crumb, depth: number): void; onBack?(): void }
export declare function Breadcrumbs(p: BreadcrumbsProps): React.ReactElement;
export interface BoardCardProps { title: string; description?: string; count?: number; preview?: string[]; lod?: LOD; selected?: boolean; dragging?: boolean; onOpen?(): void }
export declare function BoardCard(p: BoardCardProps): React.ReactElement;
export interface ImageCardProps { title: string; alt: string; src?: string; color?: string; lod?: LOD; selected?: boolean; dragging?: boolean }
export declare function ImageCard(p: ImageCardProps): React.ReactElement;
export interface NoteCardProps { title: string; body: string; lod?: LOD; dragging?: boolean }
export declare function NoteCard(p: NoteCardProps): React.ReactElement;
export declare function ZoomBadge(p: { level: LOD }): React.ReactElement;
export interface StatePanelProps { kind: 'loading' | 'error'; title?: string; message?: string; onRetry?(): void }
export declare function StatePanel(p: StatePanelProps): React.ReactElement;
declare global { interface Window { Zoomboard: { Button: typeof Button; IconButton: typeof IconButton; ZoomControls: typeof ZoomControls; Breadcrumbs: typeof Breadcrumbs; BoardCard: typeof BoardCard; ImageCard: typeof ImageCard; NoteCard: typeof NoteCard; ZoomBadge: typeof ZoomBadge; StatePanel: typeof StatePanel } } }
