export function taskErrorMessage(error) {
  return String(error?.message || error || "操作失败，请重试")
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "");
}
