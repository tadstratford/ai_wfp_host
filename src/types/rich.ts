export interface TableContent {
  data: unknown[];
  columns?: TableColumn[];
  options?: Record<string, unknown>;
}

export interface TableColumn {
  name: string;
  type: "text" | "number" | "currency" | "percentage" | "date";
  align?: "left" | "right" | "center";
  width?: string;
}

export interface ChartContent {
  type: "bar" | "pie" | "line" | "progress";
  data: ChartData;
  options?: Record<string, unknown>;
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
}

export interface FormContent {
  fields: FormField[];
  endpoint?: string;
}

export interface FormField {
  name: string;
  type: "text" | "textarea" | "number" | "date" | "boolean" | "select";
  label: string;
  description?: string;
  required?: boolean;
  value?: unknown;
  options?: { value: string; label: string }[];
}
