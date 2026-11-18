import { requireScope, type SccviPrincipal } from './sso-jwt.guard';

export const admin = (p: SccviPrincipal) => requireScope(p, 'sccvi.admin');
export const clinician = (p: SccviPrincipal) => requireScope(p, 'sccvi.clinical', 'sccvi.admin');
export const reader = (p: SccviPrincipal) => requireScope(p, 'sccvi.read', 'sccvi.clinical', 'sccvi.admin');
