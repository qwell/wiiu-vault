export type TitleKind =
    | 'vWii'
    | 'Base'
    | 'Demo'
    | 'FCT'
    | 'DLC'
    | 'Update'
    | 'System App'
    | 'System Data'
    | 'Unknown'
    | 'System Applet';

export type TitleEntry = {
    titleId: string;
    kind: TitleKind;
    version: number | null;
    titleName: string;
    region: string | null;
    iconUrl: string | null;
};

export type TitleSlot = {
    kind: 'Update' | 'DLC';
    titleId: string | null;
    version: number | null;
    available: boolean;
    existsLocally: boolean;
};

export type TitleGroup = {
    family: string;
    name: string;
    region: string | null;
    iconUrl: string | null;
    parentMissing: boolean;
    titleInDatabase: boolean;

    base: TitleEntry | null;
    update: TitleEntry | null;
    dlc: TitleEntry[];

    demo: TitleEntry | null;
    fct: TitleEntry | null;
    systemApplet: TitleEntry | null;
    systemApp: TitleEntry | null;
    systemData: TitleEntry | null;
    vWii: TitleEntry | null;
    unknown: TitleEntry[];

    updateSlot: TitleSlot;
    dlcSlot: TitleSlot;

    gameTitleId: string | null;
    updateTitleId: string | null;
    dlcTitleId: string | null;

    gameSizeBytes: number | null;
    updateSizeBytes: number | null;
    dlcSizeBytes: number | null;
};

export type LibraryResponse = {
    groups: TitleGroup[];
};
