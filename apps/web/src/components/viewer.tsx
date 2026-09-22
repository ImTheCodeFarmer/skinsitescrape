"use client";

import * as React from "react";

/**
 * Who is looking: whether the signed-in account is a dashboard admin, and
 * the admin marks they have changed on players during this page's life, so
 * every name of that player updates at once without the row data carrying
 * the flag.
 */
type Viewer = { admin: boolean; marks: Map<string, boolean>; setMark: (site: string, id: string, admin: boolean) => void };

const Ctx = React.createContext<Viewer>({ admin: false, marks: new Map(), setMark: () => {} });

export function ViewerProvider({ admin, children }: { admin: boolean; children: React.ReactNode }) {
  const [marks, setMarks] = React.useState(() => new Map<string, boolean>());
  const setMark = React.useCallback((site: string, id: string, v: boolean) => setMarks((m) => new Map(m).set(`${site}:${id}`, v)), []);
  const value = React.useMemo(() => ({ admin, marks, setMark }), [admin, marks, setMark]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useViewer = () => React.useContext(Ctx);
