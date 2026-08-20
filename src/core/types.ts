export type RenderMode = "exact" | "contain" | "cover";
export type OutputFormat = "png" | "mp4";

export interface CanvasSize { width: number; height: number }
export interface OutputRequest {
  preset: string;
  mode?: RenderMode;
  duration_seconds?: number;
  frame_rate?: number;
}
export interface Manifest {
  schema_version: 1;
  content_id: string;
  brand: string;
  version: number;
  source: string;
  canvas: CanvasSize;
  animation?: boolean;
  transparent_background?: boolean;
  required_fonts?: string[];
  outputs: OutputRequest[];
}
export interface Preset extends CanvasSize { format: OutputFormat }
export interface InspectionReport {
  source: string;
  files: string[];
  localDependencies: string[];
  remoteDependencies: string[];
  fontFaces: string[];
  animationSignals: string[];
  issues: string[];
}
export interface OutputQa {
  preset: string;
  file: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  alpha?: boolean;
  fonts_loaded: boolean;
  assets_loaded: boolean;
  qa: "passed" | "failed";
  errors: string[];
}
export interface QaReport {
  content_id: string;
  status: "passed" | "failed";
  inspection: InspectionReport;
  outputs: OutputQa[];
}
