import {
    type LibraryResponse,
    type TitleGroup,
    type TitleEntry,
    TitleKinds,
    type ChildKind,
    PARENT_KINDS,
} from '../shared/shared.js';

type GroupStatus = 'complete' | 'incomplete' | 'unknown';
type SlotBadgeState = 'complete' | 'incomplete' | 'na' | 'unknown';

let refreshLibrary: (() => Promise<void>) | null = null;

function formatRegion(region: string | null): {
    text: string;
    flag: string;
    class?: string;
} {
    switch (region) {
        case 'USA':
            return { text: 'USA', flag: '🇺🇸', class: 'distress' };
        case 'EUR':
            return { text: 'EUR', flag: '🇪🇺' };
        case 'JPN':
            return { text: 'JPN', flag: '🇯🇵' };
        case 'UNK':
            return { text: 'UNK', flag: '🏴‍☠️', class: 'arrr' };
        default:
            return { text: region ?? '', flag: '' };
    }
}

function formatSize(sizeBytes: number | null): string {
    if (sizeBytes === null) {
        return '-';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = sizeBytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function getEntry(
    group: TitleGroup,
    kinds: TitleKinds | readonly TitleKinds[]
): TitleEntry | null {
    const kindList = Array.isArray(kinds) ? kinds : [kinds];
    return group.entries.find((entry) => kindList.includes(entry.kind)) ?? null;
}

function isChildExpected(group: TitleGroup, childKind: ChildKind): boolean {
    return group.expectedChildren.includes(childKind);
}

function formatTooltip(group: TitleGroup): string {
    const parentEntry = getEntry(group, PARENT_KINDS);
    const updateEntry = getEntry(group, TitleKinds.Update);
    const dlcEntry = getEntry(group, TitleKinds.DLC);

    return [
        `Game: ${parentEntry ? `${formatSize(parentEntry.sizeBytes)} (${parentEntry.titleId})` : '-'}`,
        `Update: ${updateEntry ? `${formatSize(updateEntry.sizeBytes)} (${updateEntry.titleId})` : '-'}`,
        `DLC: ${dlcEntry ? `${formatSize(dlcEntry.sizeBytes)} (${dlcEntry.titleId})` : '-'}`,
    ].join('\n');
}

function getGroupStatus(group: TitleGroup): GroupStatus {
    if (!group.titleInDatabase) {
        return 'unknown';
    }

    if (
        !getEntry(group, PARENT_KINDS) ||
        (isChildExpected(group, TitleKinds.Update) &&
            !getEntry(group, TitleKinds.Update)) ||
        (isChildExpected(group, TitleKinds.DLC) &&
            !getEntry(group, TitleKinds.DLC))
    ) {
        return 'incomplete';
    }

    return 'complete';
}

function getGameBadgeState(group: TitleGroup): SlotBadgeState {
    if (!group.titleInDatabase) {
        return 'unknown';
    }

    if (getEntry(group, PARENT_KINDS)) {
        return 'complete';
    }

    return 'incomplete';
}

function getSlotBadgeState(
    group: TitleGroup,
    childKind: ChildKind
): SlotBadgeState {
    if (!isChildExpected(group, childKind)) {
        return 'na';
    }

    const entry = getEntry(group, childKind);

    return entry ? 'complete' : 'incomplete';
}

function renderSlotBadge(label: string, state: SlotBadgeState): HTMLElement {
    const badge = document.createElement('div');
    badge.className = `title-slot-badge title-slot-badge-${state}`;
    badge.textContent = label;
    return badge;
}

function renderGroup(group: TitleGroup): HTMLElement | null {
    if (!group.name) {
        return null;
    }

    const status = getGroupStatus(group);

    const root = document.createElement('div');
    root.className = `title-group title-group-${status}`;
    root.title = formatTooltip(group);

    if (group.iconUrl) {
        const image = document.createElement('img');
        image.className = 'title-icon';
        image.src = group.iconUrl;
        image.alt = group.name;
        root.append(image);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'title-icon-placeholder';
        root.append(placeholder);
    }

    const header = document.createElement('div');
    header.className = 'title-group-header';
    header.textContent = group.name;
    root.append(header);

    const badges = document.createElement('div');
    badges.className = 'title-slot-badges';

    const badgeList = document.createElement('div');
    badgeList.className = 'title-slot-badge-list';
    badgeList.append(
        renderSlotBadge(TitleKinds.Base, getGameBadgeState(group)),
        renderSlotBadge(
            TitleKinds.Update,
            getSlotBadgeState(group, TitleKinds.Update)
        ),
        renderSlotBadge(
            TitleKinds.DLC,
            getSlotBadgeState(group, TitleKinds.DLC)
        )
    );
    badges.append(badgeList);

    if (group.region) {
        const formattedRegion = formatRegion(group.region);

        const regionParent = document.createElement('div');
        regionParent.className = 'title-region';

        const flag = document.createElement('span');
        flag.className = formattedRegion.class ?? '';
        flag.textContent = formattedRegion.flag;

        const region = document.createElement('span');
        region.className = 'region';
        region.textContent = formattedRegion.text;

        regionParent.append(flag, region);
        badges.append(regionParent);
    }

    root.append(badges);

    return root;
}

function normalizeSearchText(value: string | null | undefined): string {
    return (value ?? '').toLocaleLowerCase();
}

function groupMatchesSearch(group: TitleGroup, search: string): boolean {
    if (!search) {
        return true;
    }

    const haystacks = [
        group.name,
        group.family,
        group.region,
        ...group.entries.flatMap((entry) => [
            entry.titleId,
            entry.titleName,
            entry.kind,
            entry.region,
        ]),
    ];

    return haystacks.some((value) =>
        normalizeSearchText(value).includes(search)
    );
}

function compareGroups(a: TitleGroup, b: TitleGroup): number {
    const options: Intl.CollatorOptions = { sensitivity: 'base' };
    return (
        a.name.localeCompare(b.name, undefined, options) ||
        (a.region ?? '').localeCompare(b.region ?? '', undefined, options)
    );
}

function collectRegions(groups: TitleGroup[]): string[] {
    const seen = new Set<string>();

    for (const group of groups) {
        if (group.region) {
            seen.add(group.region);
        }
    }

    return [...seen].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
}

function renderGroups(
    allGroups: TitleGroup[],
    grid: HTMLElement,
    statusValue: string,
    regionValue: string,
    searchValue: string
): void {
    const normalizedSearch = normalizeSearchText(searchValue.trim());

    const filteredGroups = [...allGroups].filter((group) => {
        const groupStatus = getGroupStatus(group);

        if (statusValue !== 'all' && groupStatus !== statusValue) {
            return false;
        }

        if (regionValue !== 'all' && group.region !== regionValue) {
            return false;
        }

        return groupMatchesSearch(group, normalizedSearch);
    });

    grid.replaceChildren();

    for (const group of filteredGroups) {
        const render = renderGroup(group);
        if (!render) {
            continue;
        }

        grid.append(render);
    }
}

function buildControls(
    groups: TitleGroup[],
    grid: HTMLElement,
    loading = false
): HTMLElement {
    const controls = document.createElement('div');
    controls.className = 'library-controls';

    const refreshButton = document.createElement('button');
    refreshButton.className = 'refresh-button library-refresh';
    refreshButton.type = 'button';
    refreshButton.title = 'Refresh library';
    refreshButton.setAttribute('aria-label', 'Refresh library');
    refreshButton.textContent = '↻';
    refreshButton.disabled = loading;

    const regionText = document.createElement('div');
    regionText.className = 'library-label library-label-region';
    regionText.textContent = 'Region';

    const statusText = document.createElement('div');
    statusText.className = 'library-label library-label-status';
    statusText.textContent = 'Status';

    const searchText = document.createElement('div');
    searchText.className = 'library-label library-label-search';
    searchText.textContent = 'Search';

    const regionSelect = document.createElement('select');
    regionSelect.className = 'library-select library-field-region';
    regionSelect.disabled = loading || groups.length === 0;

    const allRegionsOption = document.createElement('option');
    allRegionsOption.value = 'all';
    allRegionsOption.textContent = 'All';
    regionSelect.append(allRegionsOption);

    for (const region of collectRegions(groups)) {
        const option = document.createElement('option');
        option.value = region;
        option.textContent = region;
        regionSelect.append(option);
    }

    const statusSelect = document.createElement('select');
    statusSelect.className = 'library-select library-field-status';
    statusSelect.disabled = loading || groups.length === 0;

    const statusOptions: Array<{ value: string; label: string }> = [
        { value: 'all', label: 'All' },
        { value: 'complete', label: 'Complete' },
        { value: 'incomplete', label: 'Incomplete' },
        { value: 'unknown', label: 'Unknown' },
    ];

    for (const statusOption of statusOptions) {
        const option = document.createElement('option');
        option.value = statusOption.value;
        option.textContent = statusOption.label;
        statusSelect.append(option);
    }

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Name, title ID, or region';
    searchInput.className = 'library-search library-field-search';
    searchInput.disabled = loading || groups.length === 0;

    const update = (): void => {
        renderGroups(
            groups,
            grid,
            statusSelect.value,
            regionSelect.value,
            searchInput.value
        );
    };

    searchInput.addEventListener('input', update);
    regionSelect.addEventListener('change', update);
    statusSelect.addEventListener('change', update);

    refreshButton.addEventListener('click', () => {
        if (!refreshButton.disabled && refreshLibrary) {
            void refreshLibrary();
        }
    });

    controls.append(
        refreshButton,
        regionText,
        statusText,
        searchText,
        regionSelect,
        statusSelect,
        searchInput
    );

    if (groups.length > 0) {
        update();
    }

    return controls;
}

function buildLibraryContent(
    groups: TitleGroup[],
    loading = false
): DocumentFragment {
    const fragment = document.createDocumentFragment();

    const grid = document.createElement('div');
    grid.className = 'library-grid';

    const controls = buildControls(groups, grid, loading);
    fragment.append(controls, grid);

    const loadingLine = document.createElement('div');
    loadingLine.className = 'library-loading';
    loadingLine.textContent = loading ? 'Loading...' : '';
    fragment.append(loadingLine);

    if (!loading && groups.length > 0) {
        renderGroups(groups, grid, 'all', 'all', '');
    }

    return fragment;
}

async function loadLibrary(output: HTMLElement): Promise<void> {
    output.replaceChildren(buildLibraryContent([], true));

    try {
        const response = await fetch('/api/library');

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
        }

        const data = (await response.json()) as LibraryResponse;

        for (const group of data.groups) {
            group.entries.sort((a, b) => b.version - a.version);
        }

        const groups = [...data.groups].sort(compareGroups);

        output.replaceChildren(buildLibraryContent(groups, false));
    } catch (error) {
        console.error(error);

        output.replaceChildren();

        const message = document.createElement('div');
        message.textContent = 'Failed to load library.';
        output.append(message);
    }
}

refreshLibrary = async (): Promise<void> => {
    const output = document.querySelector<HTMLElement>('#output');

    if (!output) {
        throw new Error('Missing #output');
    }

    await loadLibrary(output);
};

void refreshLibrary();
