import './FilterTabs.css';

export default function FilterTabs({ filters, activeFilter, onChange }) {
  return (
    <div className="filters" role="tablist" aria-label="Project filters">
      {filters.map((filter) => {
        const selected = filter === activeFilter;

        return (
          <button
            key={filter}
            className={selected ? 'filter-pill is-active' : 'filter-pill'}
            onClick={() => onChange(filter)}
            role="tab"
            aria-selected={selected}
            type="button"
          >
            {filter}
          </button>
        );
      })}
    </div>
  );
}
