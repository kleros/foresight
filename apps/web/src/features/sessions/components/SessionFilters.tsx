"use client";

import { Searchbar, Tag } from "@kleros/ui-components-library";

import { SESSION_STATES, STATE_LABELS, type SessionFilters as Filters } from "../utils/listing";

export function SessionFilters({ filters, onChange }: { filters: Filters; onChange: (next: Filters) => void }) {
  return (
    <div className="fs-filterbar">
      <div className="fs-filterbar__search">
        <Searchbar
          value={filters.query}
          onChange={(query) => onChange({ ...filters, query })}
          placeholder="Search sessions"
          aria-label="Search sessions"
        />
      </div>
      <div className="fs-filterbar__states" role="group" aria-label="Filter by status">
        {SESSION_STATES.map((state) => (
          <Tag
            key={state}
            className="fs-echo"
            text={STATE_LABELS[state]}
            active={filters.state === state}
            onPress={() => onChange({ ...filters, state })}
          />
        ))}
      </div>
    </div>
  );
}
