import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Filter, Tag, ArrowUpDown } from "lucide-react";

export type ActivityFilter = "all" | "stale" | "cleanable";

interface ProjectsListHeaderProps {
    searchQuery: string;
    techFilter: string;
    tagFilter: string;
    sortBy: string;
    activityFilter: ActivityFilter;
    allTechs: string[];
    availableTags: string[];
    onSearchChange: (query: string) => void;
    onTechFilterChange: (value: string) => void;
    onTagFilterChange: (value: string) => void;
    onSortChange: (value: string) => void;
    onActivityFilterChange: (value: ActivityFilter) => void;
}

const ACTIVITY_CHIPS: { value: ActivityFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "stale", label: "Stale" },
    { value: "cleanable", label: "Needs Cleanup" },
];

export function ProjectsListHeader({
    searchQuery,
    techFilter,
    tagFilter,
    sortBy,
    activityFilter,
    allTechs,
    availableTags,
    onSearchChange,
    onTechFilterChange,
    onTagFilterChange,
    onSortChange,
    onActivityFilterChange,
}: ProjectsListHeaderProps) {
    return (
        <div className="px-5 pt-3 pb-3 space-y-3">
            {/* Filter chips */}
            <div className="flex items-center gap-2">
                {ACTIVITY_CHIPS.map(chip => (
                    <button
                        key={chip.value}
                        onClick={() => onActivityFilterChange(chip.value)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            activityFilter === chip.value
                                ? "bg-primary/20 text-primary border border-primary/30"
                                : "bg-white/5 text-zinc-400 border border-white/5 hover:bg-white/10 hover:text-white"
                        }`}
                    >
                        {chip.label}
                    </button>
                ))}
            </div>

            {/* Search + filters */}
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <Input
                        placeholder="Search by name or technology..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="pl-9 pr-9 h-9 bg-white/5 border-white/10 text-white placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary/50 transition-all rounded-full"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => onSearchChange("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>

                <Select value={techFilter} onValueChange={onTechFilterChange}>
                    <SelectTrigger className="w-[130px] h-9 bg-white/5 border-white/10 text-white rounded-full">
                        <div className="flex items-center gap-2">
                            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                            <SelectValue placeholder="Tech" />
                        </div>
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a1e] border-white/10 text-white shadow-2xl">
                        <SelectItem value="all">All Tech</SelectItem>
                        {allTechs.map(tech => (
                            <SelectItem key={tech} value={tech}>{tech}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={tagFilter} onValueChange={onTagFilterChange}>
                    <SelectTrigger className="w-[120px] h-9 bg-white/5 border-white/10 text-white rounded-full">
                        <div className="flex items-center gap-2">
                            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                            <SelectValue placeholder="Tag" />
                        </div>
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a1e] border-white/10 text-white shadow-2xl">
                        <SelectItem value="all">All Tags</SelectItem>
                        {availableTags.map(tag => (
                            <SelectItem key={tag} value={tag} className="capitalize">{tag}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={sortBy} onValueChange={onSortChange}>
                    <SelectTrigger className="w-[130px] h-9 bg-white/5 border-white/10 text-white rounded-full">
                        <div className="flex items-center gap-2">
                            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                            <SelectValue />
                        </div>
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a1e] border-white/10 text-white shadow-2xl">
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="size">Size</SelectItem>
                        <SelectItem value="recent">Recent</SelectItem>
                        <SelectItem value="cleanable">Cleanable</SelectItem>
                        <SelectItem value="technology">Technology</SelectItem>
                        <SelectItem value="health">Health</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
