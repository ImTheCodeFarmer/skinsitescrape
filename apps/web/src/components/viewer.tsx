"use client";

import * as React from "react";

/** The marks a dashboard admin can set on a player. A mark missing from a player's entry has not been changed or looked up. */
export type Marks = { admin?: boolean; streamer?: boolean };

/**
 * Who is looking: whether the signed-in account is a dashboard admin, and
 * the admin and streamer marks they have changed on players during this
 * page's life, so every name of that player updates at once without the
 * row data carrying the flag.
 */
type Viewer = { admin: boolean; marks: Map<string, Marks>; setMark: (site: string, id: string, marks: Marks) => void };

const Ctx = React.createContext<Viewer>({ admin: false, marks: new Map(), setMark: () => {} });

export function ViewerProvider({ admin, children }: { admin: boolean; children: React.ReactNode }) {
  const [marks, setMarks] = React.useState(() => new Map<string, Marks>());
  const setMark = React.useCallback((site: string, id: string, v: Marks) => setMarks((m) => new Map(m).set(`${site}:${id}`, { ...m.get(`${site}:${id}`), ...v })), []);
  const value = React.useMemo(() => ({ admin, marks, setMark }), [admin, marks, setMark]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useViewer = () => React.useContext(Ctx);
