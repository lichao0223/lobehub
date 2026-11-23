'use client';

import type { TfsRepository } from '@lobechat/types';
import { parseTfsRepository } from '@lobechat/utils/tfs';
import { ActionIcon, Button, Flexbox, Input, Select, Text } from '@lobehub/ui';
import { GitBranchIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import {
  MAX_REPOSITORIES,
  type PickedRepository,
} from '@/features/Projects/CreateFromGithub/RepositoryField';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { tfsService } from '@/services/tfs';
import { useTfsData } from '@/store/tfs/action';

import { useTfsConnection } from './useTfsConnection';
import { useTfsPickerPages } from './useTfsPickerPages';

/** The same shape the GitHub picker fills; the first entry is the main repository. */
export const toPickedRepository = (repository: TfsRepository): PickedRepository => ({
  defaultBranch: repository.defaultBranch,
  fullName: `${repository.project.name}/${repository.name}`,
  url: repository.remoteUrl,
});

const sameRepository = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `project/name` back to its two parts; TFS project and repository names hold no slash. */
const splitFullName = (fullName: string) => {
  const index = fullName.indexOf('/');
  if (index <= 0) return;
  return { name: fullName.slice(index + 1), project: fullName.slice(0, index) };
};

interface BranchSelectProps {
  binding: string;
  disabled?: boolean;
  onChange: (branch: string) => void;
  project: string;
  repository: string;
  value?: string;
}

/**
 * The branch one picked repository checks out. Every row loads its own branch
 * list, so repositories from different projects can be picked side by side.
 */
const BranchSelect = ({
  binding,
  disabled,
  onChange,
  project,
  repository,
  value,
}: BranchSelectProps) => {
  const { t } = useTranslation('integration');
  const branches = useTfsPickerPages(
    { binding, kind: 'branches', project, repository },
    Boolean(binding && repository),
    { autoLoadAll: true },
  );
  const names = [
    ...new Set(
      [value, ...branches.items.map((branch) => branch.name)].filter(
        (name): name is string => !!name,
      ),
    ),
  ];

  return (
    <Flexbox horizontal align="center" gap={4}>
      <Select
        showSearch
        aria-label={t('tfs.branch')}
        disabled={disabled}
        loading={branches.isValidating}
        options={names.map((name) => ({ label: name, value: name }))}
        placeholder={t('tfs.branch')}
        value={value}
        onChange={(next) => onChange(String(next))}
      />
      {branches.truncated && (
        <Button
          disabled={disabled}
          loading={branches.isValidating}
          size="small"
          onClick={branches.loadMore}
        >
          {t('tfs.loadMoreBranches')}
        </Button>
      )}
    </Flexbox>
  );
};

export interface TfsRepositoryPickerProps {
  /** At most this many repositories in multiple mode; an environment's limit by default. */
  max?: number;
  /** Add to a list instead of replacing the one repository. */
  multiple?: boolean;
  /** Multiple mode: the picked repositories, with their branches, changed. */
  onChange?: (repositories: PickedRepository[]) => void;
  /** The previous choice no longer applies; single mode only. */
  onClear: () => void;
  onLeave?: () => void;
  /** Single mode: a repository was picked, or its branch changed. */
  onSelect?: (repository: TfsRepository) => void;
  /** Multiple mode: every picked repository, the main one first. */
  value?: PickedRepository[];
}

export const TfsRepositoryPicker = ({
  max = MAX_REPOSITORIES,
  multiple = false,
  onChange,
  onClear,
  onLeave,
  onSelect,
  value = [],
}: TfsRepositoryPickerProps) => {
  const { t } = useTranslation('integration');
  const navigate = useWorkspaceAwareNavigate();
  const status = useTfsConnection();
  const binding = status.connection?.identity?.updatedAt ?? '';
  const connected = Boolean(binding);
  const [project, setProject] = useState('');
  const [repository, setRepository] = useState('');
  const [manual, setManual] = useState<TfsRepository>();
  const [branch, setBranch] = useState<string>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const projects = useTfsPickerPages({ binding, kind: 'projects' }, connected);
  const repos = useTfsData(
    { binding, kind: 'repositories', project },
    connected && Boolean(project),
  );
  const branches = useTfsPickerPages(
    { binding, kind: 'branches', project, repository },
    connected && Boolean(repository),
    { autoLoadAll: true },
  );
  const selected = manual ?? repos.data?.repositories?.items.find((r) => r.id === repository);
  const failure = status.error || projects.error || repos.error || branches.error || error;
  const pending = !status.connection && !status.error;
  const maxReached = multiple && value.length >= max;

  /**
   * Add a repository, or refresh it when it is already picked. Picking the same
   * repository twice never duplicates it; it keeps the list's order, which is
   * also the checkout order.
   */
  const addRepository = (repository: TfsRepository) => {
    const added = toPickedRepository(repository);
    const index = value.findIndex((item) => sameRepository(item.fullName, added.fullName));
    if (index >= 0) {
      const next = [...value];
      next[index] = { ...next[index], ...added };
      onChange?.(next);
      return;
    }
    if (value.length >= max) return;
    onChange?.([...value, added]);
  };

  const changeBranch = (fullName: string, defaultBranch: string) => {
    onChange?.(
      value.map((item) =>
        sameRepository(item.fullName, fullName) ? { ...item, defaultBranch } : item,
      ),
    );
  };

  const removeRepository = (fullName: string) => {
    onChange?.(value.filter((item) => !sameRepository(item.fullName, fullName)));
  };

  const changeProject = (next: string) => {
    // In multiple mode the already picked repositories stay valid across
    // projects, so only single mode clears the old choice.
    if (!multiple) onClear();
    setManual(undefined);
    setProject(String(next ?? ''));
    setRepository('');
    setBranch(undefined);
  };

  const changeRepository = (next: string) => {
    const repo = repos.data?.repositories?.items.find((r) => r.id === next);
    setManual(undefined);
    if (multiple) {
      // Adding returns the picker to its placeholder so the next repository is
      // one click away; branches live in the picked list.
      setRepository('');
      if (repo) addRepository(repo);
      return;
    }
    setRepository(String(next ?? ''));
    setBranch(repo?.defaultBranch);
    if (repo) onSelect?.(repo);
    else onClear();
  };

  const changeSelectedBranch = (next: string) => {
    if (!selected) return;
    setBranch(String(next));
    onSelect?.({ ...selected, defaultBranch: String(next) });
  };

  const resolve = async () => {
    if (!parseTfsRepository(url, status.connection?.collectionUrl ?? undefined)) return;
    setBusy(true);
    setError(undefined);
    try {
      const repo = await tfsService.resolveRepository(url);
      setManual(repo);
      setProject(repo.project.name);
      setRepository(repo.id);
      setBranch(repo.defaultBranch);
      if (multiple) {
        addRepository(repo);
        setUrl('');
      } else {
        onSelect?.(repo);
      }
    } catch {
      setError(new Error(t('tfs.resolveFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox gap={12}>
      <Text fontSize={12} type="secondary">
        {t('tfs.personalHint')}
      </Text>
      {failure && (
        <AsyncError
          error={failure}
          onRetry={() => {
            setError(undefined);
            void Promise.all([
              status.revalidate(),
              ...(connected ? [projects.revalidate()] : []),
              ...(project ? [repos.revalidate()] : []),
              ...(repository ? [branches.revalidate()] : []),
            ]);
          }}
        />
      )}
      {pending ? (
        <Text>{t('tfs.loading')}</Text>
      ) : !connected ? (
        status.connection?.configured === false ? (
          <Text type="secondary">{t('tfs.notConfigured')}</Text>
        ) : (
          <Button
            onClick={() => {
              onLeave?.();
              navigate('/settings/tfs');
            }}
          >
            {t('tfs.connect')}
          </Button>
        )
      ) : (
        <>
          <Select
            showSearch
            aria-label={t('tfs.project')}
            disabled={busy}
            loading={projects.isValidating}
            options={projects.items.map((p) => ({ label: p.name, value: p.name }))}
            placeholder={t('tfs.project')}
            value={project || undefined}
            onChange={changeProject}
          />
          {projects.next && (
            <Button
              disabled={busy}
              loading={projects.isValidating}
              size="small"
              onClick={projects.loadMore}
            >
              {t('tfs.loadMoreProjects')}
            </Button>
          )}
          {(projects.data?.projects?.items.length === 0 ||
            (project && repos.data?.repositories?.items.length === 0)) && (
            <Text type="secondary">{t('tfs.empty')}</Text>
          )}
          {project && (
            <Select
              showSearch
              aria-label={t('tfs.repository')}
              disabled={busy || maxReached}
              loading={repos.isValidating}
              placeholder={t('tfs.repository')}
              value={repository || undefined}
              options={
                repos.data?.repositories?.items.map((r) => ({ label: r.name, value: r.id })) ?? []
              }
              onChange={changeRepository}
            />
          )}
          {maxReached && (
            <Text fontSize={12} type="secondary">
              {t('tfs.maxRepositories', { count: max })}
            </Text>
          )}
          {multiple ? (
            value.length > 0 && (
              <Flexbox gap={6}>
                <Text fontSize={13} weight={500}>
                  {t('tfs.pickedRepositories')}
                </Text>
                {value.map((item) => {
                  const parts = splitFullName(item.fullName);
                  return (
                    <Flexbox horizontal align="center" gap={8} key={item.fullName}>
                      <GitBranchIcon size={14} />
                      <Text ellipsis style={{ flex: 1 }} weight={500}>
                        {item.fullName}
                      </Text>
                      {parts && (
                        <BranchSelect
                          binding={binding}
                          disabled={busy}
                          project={parts.project}
                          repository={parts.name}
                          value={item.defaultBranch}
                          onChange={(next) => changeBranch(item.fullName, next)}
                        />
                      )}
                      <ActionIcon
                        icon={XIcon}
                        size="small"
                        title={t('tfs.removeRepository')}
                        onClick={() => removeRepository(item.fullName)}
                      />
                    </Flexbox>
                  );
                })}
              </Flexbox>
            )
          ) : (
            <>
              {selected && (
                <Select
                  showSearch
                  aria-label={t('tfs.branch')}
                  disabled={busy}
                  loading={branches.isValidating}
                  placeholder={t('tfs.branch')}
                  value={branch ?? selected.defaultBranch}
                  options={[
                    ...new Set(
                      [
                        branch ?? selected.defaultBranch,
                        ...branches.items.map((b) => b.name),
                      ].filter((name): name is string => !!name),
                    ),
                  ].map((name) => ({ label: name, value: name }))}
                  onChange={changeSelectedBranch}
                />
              )}
              {selected && branches.truncated && (
                <Button
                  disabled={busy}
                  loading={branches.isValidating}
                  size="small"
                  onClick={branches.loadMore}
                >
                  {t('tfs.loadMoreBranches')}
                </Button>
              )}
              {selected && (
                <Text fontSize={12} type="secondary">
                  {selected.project.name}/{selected.name}
                  {branch ? ` · ${branch}` : ''}
                </Text>
              )}
            </>
          )}
          <Text fontSize={12}>{t('tfs.url')}</Text>
          <Flexbox horizontal gap={8}>
            <Input
              aria-label={t('tfs.url')}
              disabled={busy}
              placeholder={`${status.connection?.collectionUrl}/Project/_git/Repository`}
              value={url}
              aria-invalid={
                Boolean(url) &&
                !parseTfsRepository(url, status.connection?.collectionUrl ?? undefined)
              }
              onChange={(e) => {
                if (!multiple) onClear();
                setManual(undefined);
                setRepository('');
                setBranch(undefined);
                setUrl(e.target.value);
              }}
            />
            <Button
              disabled={!parseTfsRepository(url, status.connection?.collectionUrl ?? undefined)}
              loading={busy}
              onClick={() => void resolve()}
            >
              {t('tfs.verify')}
            </Button>
          </Flexbox>
          {url && !parseTfsRepository(url, status.connection?.collectionUrl ?? undefined) && (
            <Text type="danger">{t('tfs.invalidUrl')}</Text>
          )}
        </>
      )}
    </Flexbox>
  );
};
