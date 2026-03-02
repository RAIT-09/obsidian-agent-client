import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
	PickerItem,
	PickerPreview,
	PickerProvider,
	PickerCategory,
} from "../components/picker/types";
import { CATEGORY_LABELS, CATEGORY_ICONS } from "../components/picker/types";

export interface UsePickerReturn {
	isOpen: boolean;
	query: string;
	/** Items to display (filtered + category entries when applicable) */
	items: PickerItem[];
	/** All search-result items before filtering */
	allItems: PickerItem[];
	selectedIndex: number;
	preview: PickerPreview | null;
	activeFilter: PickerCategory | null;
	open: (initialQuery?: string) => void;
	close: () => void;
	setQuery: (query: string) => void;
	setFilter: (filter: PickerCategory | null) => void;
	navigate: (direction: "up" | "down") => void;
	selectCurrent: () => void;
	selectAt: (index: number) => void;
	setSelectedIndex: (index: number) => void;
}

export type PickerSortFn = (
	items: PickerItem[],
	query: string,
) => PickerItem[];

/**
 * @param providers  - search providers
 * @param sortFn     - optional sort applied after merging provider results
 * @param categoryEntries - categories to show as navigable items (drill-down)
 */
export function usePicker(
	providers: PickerProvider[],
	sortFn?: PickerSortFn,
	categoryEntries?: PickerCategory[],
): UsePickerReturn {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQueryState] = useState("");
	const [searchItems, setSearchItems] = useState<PickerItem[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [preview, setPreview] = useState<PickerPreview | null>(null);
	const [activeFilter, setActiveFilterState] = useState<PickerCategory | null>(
		null,
	);

	const providersRef = useRef(providers);
	providersRef.current = providers;

	const sortFnRef = useRef(sortFn);
	sortFnRef.current = sortFn;

	const searchIdRef = useRef(0);
	const lastQueryRef = useRef("");

	const allItems = useMemo(() => {
		if (!activeFilter) return searchItems;
		return searchItems.filter((item) => item.category === activeFilter);
	}, [searchItems, activeFilter]);

	const items = useMemo(() => {
		if (activeFilter) {
			const backItem: PickerItem = {
				id: "__back__",
				label: CATEGORY_LABELS[activeFilter],
				icon: "chevron-left",
				category: activeFilter,
				isBack: true,
				data: null,
			};
			return [backItem, ...allItems];
		}
		if (!categoryEntries || categoryEntries.length === 0) {
			return allItems;
		}

		const q = query.toLowerCase();
		const afterFilter = categoryEntries.filter((cat) => {
			if (q) return CATEGORY_LABELS[cat].toLowerCase().includes(q);
			return searchItems.some((item) => item.category === cat);
		});
		const catItems: PickerItem[] = afterFilter
			.map((cat) => ({
				id: `__category__:${cat}`,
				label: CATEGORY_LABELS[cat],
				icon: CATEGORY_ICONS[cat],
				category: cat,
				isCategory: true,
				data: null,
			}));

		const combined = [...allItems, ...catItems];
		const sorted = sortFnRef.current
			? sortFnRef.current(combined, query)
			: combined;
		return sorted;
	}, [allItems, searchItems, categoryEntries, activeFilter, query]);

	const runSearch = useCallback(async (q: string) => {
		const id = ++searchIdRef.current;
		const merged: PickerItem[] = [];

		for (const provider of providersRef.current) {
			const result = await provider.search(q);
			if (searchIdRef.current !== id) return;
			merged.push(...result);
		}

		const sorted = sortFnRef.current
			? sortFnRef.current(merged, q)
			: merged;
		setSearchItems(sorted);
		setSelectedIndex(0);
		setPreview(null);
	}, []);

	const setQuery = useCallback(
		(q: string) => {
			if (q === lastQueryRef.current) return;
			lastQueryRef.current = q;
			setQueryState(q);
			setActiveFilterState(null);
			void runSearch(q);
		},
		[runSearch],
	);

	const open = useCallback(
		(initialQuery = "") => {
			lastQueryRef.current = initialQuery;
			setIsOpen(true);
			setQueryState(initialQuery);
			setActiveFilterState(null);
			void runSearch(initialQuery);
		},
		[runSearch],
	);

	const close = useCallback(() => {
		lastQueryRef.current = "";
		setIsOpen(false);
		setQueryState("");
		setSearchItems([]);
		setSelectedIndex(0);
		setPreview(null);
		setActiveFilterState(null);
		searchIdRef.current++;
	}, []);

	const setFilter = useCallback(
		(filter: PickerCategory | null) => {
			setActiveFilterState(filter);
			setSelectedIndex(0);
			if (filter !== null) {
				void runSearch("");
			} else {
				void runSearch(lastQueryRef.current);
			}
		},
		[runSearch],
	);

	const navigate = useCallback(
		(direction: "up" | "down") => {
			setSelectedIndex((prev) => {
				const max = items.length - 1;
				if (max < 0) return 0;
				if (direction === "down") return Math.min(prev + 1, max);
				return Math.max(prev - 1, 0);
			});
		},
		[items.length],
	);

	const applyItem = useCallback(
		(item: PickerItem) => {
			if (item.isBack) {
				setFilter(null);
				return;
			}
			if (item.isCategory) {
				setFilter(item.category);
				return;
			}
			for (const provider of providersRef.current) {
				if (provider.category === item.category) {
					provider.apply(item);
					break;
				}
			}
			close();
		},
		[close, setFilter],
	);

	const selectCurrent = useCallback(() => {
		const item = items[selectedIndex];
		if (!item) return;
		applyItem(item);
	}, [items, selectedIndex, applyItem]);

	const selectAt = useCallback(
		(index: number) => {
			const item = items[index];
			if (!item) return;
			applyItem(item);
		},
		[items, applyItem],
	);

	useEffect(() => {
		if (!isOpen || items.length === 0) {
			setPreview(null);
			return;
		}

		const item = items[selectedIndex];
		if (!item || item.isCategory) {
			setPreview(null);
			return;
		}

		let cancelled = false;

		const fetchPreview = async () => {
			for (const provider of providersRef.current) {
				if (provider.category === item.category && provider.getPreview) {
					const result = provider.getPreview(item);
					const p =
						result instanceof Promise ? await result : result;
					if (!cancelled) setPreview(p);
					return;
				}
			}
			if (!cancelled) setPreview(null);
		};

		void fetchPreview();
		return () => {
			cancelled = true;
		};
	}, [isOpen, items, selectedIndex]);

	return {
		isOpen,
		query,
		items,
		allItems: searchItems,
		selectedIndex,
		preview,
		activeFilter,
		open,
		close,
		setQuery,
		setFilter,
		navigate,
		selectCurrent,
		selectAt,
		setSelectedIndex,
	};
}
