export const PARENT_KINDS = ['vWii', 'Base', 'Demo', 'FCT', 'System App', 'System Data', 'System Applet'] as const;
export const CHILD_KINDS = ['DLC', 'Update'] as const;

export type TitleKind = ParentKind | ChildKind | 'Unknown';
export type ParentKind = (typeof PARENT_KINDS)[number];
export type ChildKind = (typeof CHILD_KINDS)[number];

export type TitleEntry = {
    titleId: string;
    version: number;
    titleName: string;
    region: string | null;

    iconUrl: string | null;
    kind: TitleKind;
    sizeBytes: number;
};

export type TitleGroup = {
    name: string;
    region: string | null;
    iconUrl: string | null;

    entries: TitleEntry[];

    family: string;
    titleInDatabase: boolean;
    expectedChildren: ChildKind[];
};

export type LibraryResponse = {
    groups: TitleGroup[];
};
