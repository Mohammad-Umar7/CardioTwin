/** Stable ids linking a tab to its panel: tab = `${idBase}-tab-${value}`, panel = `${idBase}-panel-${value}`. */
export const tabId = (idBase: string, value: string) => `${idBase}-tab-${value}`;
export const tabPanelId = (idBase: string, value: string) => `${idBase}-panel-${value}`;
