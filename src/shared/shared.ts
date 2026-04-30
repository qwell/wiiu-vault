export enum TitleKinds {
    vWii = 'vWii',
    Base = 'Base',
    Demo = 'Demo',
    FCT = 'FCT',
    SystemApp = 'System App',
    SystemData = 'System Data',
    SystemApplet = 'System Applet',
    DLC = 'DLC',
    Update = 'Update',
    Unknown = 'Unknown',
}

export const PARENT_KINDS = [
    TitleKinds.vWii,
    TitleKinds.Base,
    TitleKinds.Demo,
    TitleKinds.FCT,
    TitleKinds.SystemApp,
    TitleKinds.SystemData,
    TitleKinds.SystemApplet,
] as const;

export const CHILD_KINDS = [TitleKinds.DLC, TitleKinds.Update] as const;

export type ParentKind = (typeof PARENT_KINDS)[number];
export type ChildKind = (typeof CHILD_KINDS)[number];
export type TitleGroupStatus =
    | 'complete'
    | 'incomplete'
    | 'missing'
    | 'unknown';

export type TitleEntry = {
    titleId: string;
    version: number;
    titleName: string;
    region: string | null;

    iconUrl: string | null;
    kind: TitleKinds;
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
    status: TitleGroupStatus;
};

export type LibraryResponse = {
    groups: TitleGroup[];
};
