import { createContext } from 'react';

/**
 * The project whose workspace inline transcript images resolve against.
 * Provided per chat surface (each pane renders its own project's transcript),
 * so the markdown renderer never needs the project threaded through props.
 */
export const ChatProjectContext = createContext<string | null>(null);
