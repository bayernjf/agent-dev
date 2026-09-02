import { FolderKanban } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import type { Project, ProjectDetail } from '../types';
import { formatDate } from '../lib/utils';
import { productTypeLabelKey } from '../lib/product-type';

export type DashboardProps = {
  projects: Project[];
  selected: ProjectDetail | null;
  loading: boolean;
  onSelectProject: (projectId: string) => void;
};

export function Dashboard({ projects, selected, loading, onSelectProject }: DashboardProps) {
  const { t, locale } = useI18n();

  return (
    <section className="dashboard-view" aria-label={t('projects.title')}>
      <div className="dashboard-content">
        <div className="section-heading">
          <div>
            <h2><FolderKanban size={18} aria-hidden="true" /> {t('projects.title')}</h2>
            <p>{t('projects.description')}</p>
          </div>
        </div>

        <div className="project-table" role="table" aria-label={t('projects.title')}>
          <div className="table-head" role="row">
            <span>{t('projects.table.project')}</span>
            <span>{t('projects.table.productType')}</span>
            <span>{t('projects.table.deliveryState')}</span>
            <span>{t('projects.table.updated')}</span>
          </div>
          {loading ? (
            <p className="empty-state">{t('projects.loading')}</p>
          ) : projects.length === 0 ? (
            <p className="empty-state">{t('projects.empty')}</p>
          ) : (
            projects.map(project => (
              <button
                className={`table-row project-row ${selected?.id === project.id ? 'selected' : ''}`}
                role="row"
                type="button"
                onClick={() => void onSelectProject(project.id)}
                key={project.id}
              >
                <strong>{project.name}</strong>
                {/* The column is headed by what it actually contains. It was labelled "Mode", which in
                    this product means Beginner or Professional — a value the table never showed and
                    the cell never held. */}
                <span>{(() => {
                  const labelKey = productTypeLabelKey(project.productType);
                  return labelKey ? t(labelKey) : project.productType;
                })()}</span>
                <span className="state">{t(`projectState.${project.state}`)}</span>
                <time dateTime={project.updatedAt}>{formatDate(project.updatedAt, locale)}</time>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
