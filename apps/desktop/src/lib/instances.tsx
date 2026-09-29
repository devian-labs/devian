// Claude Code instances (one per config folder) and which ones the user
// has excluded, available to every screen.

import { createContext, useContext, type ReactNode } from "react";
import type { ClaudeInstance } from "@/lib/agents";

interface InstancesValue {
    instances: ClaudeInstance[];
    hidden: string[];
    /** Instances the user hasn't excluded. */
    visible: ClaudeInstance[];
}

const Ctx = createContext<InstancesValue>({ instances: [], hidden: [], visible: [] });

export function InstancesProvider({ instances, hidden, children }: { instances: ClaudeInstance[]; hidden: string[]; children: ReactNode }) {
    const visible = instances.filter(i => !hidden.includes(i.id));
    return <Ctx.Provider value={{ instances, hidden, visible }}>{children}</Ctx.Provider>;
}

export function useInstances() {
    return useContext(Ctx);
}

/** Short label for a Claude instance ("Team", "Bedrock"), or null when only one is visible. */
export function useInstanceTag() {
    const { instances, visible } = useInstances();
    return (id: string | null | undefined) => {
        if (!id || visible.length < 2) return null;
        const inst = instances.find(i => i.id === id);
        return inst ? inst.label.replace(/^Claude\s+—\s+/, "") : id;
    };
}

/** True when an item tied to a Claude instance belongs to an excluded one. */
export const isHiddenInstance = (hidden: string[], instance: string | null | undefined) => !!instance && hidden.includes(instance);
