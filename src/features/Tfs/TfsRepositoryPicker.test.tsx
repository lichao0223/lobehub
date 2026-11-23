/**
 * @vitest-environment happy-dom
 */
import type * as LobeUI from '@lobehub/ui';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PickedRepository } from '@/features/Projects/CreateFromGithub/RepositoryField';

import { TfsRepositoryPicker } from './TfsRepositoryPicker';

const fixtures = vi.hoisted(() => ({
  repositories: [
    {
      defaultBranch: 'main',
      id: 'repo-a',
      name: 'RepoA',
      project: { id: 'p1', name: 'Proj' },
      remoteUrl: 'https://tfs.example.com/DefaultCollection/Proj/_git/RepoA',
    },
    {
      defaultBranch: 'develop',
      id: 'repo-b',
      name: 'RepoB',
      project: { id: 'p1', name: 'Proj' },
      remoteUrl: 'https://tfs.example.com/DefaultCollection/Proj/_git/RepoB',
    },
  ],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('./useTfsConnection', () => ({
  useTfsConnection: () => ({
    connection: {
      collectionUrl: 'https://tfs.example.com/DefaultCollection',
      configured: true,
      hasBinding: true,
      identity: { login: 'me', updatedAt: '2026-01-01T00:00:00.000Z' },
    },
    error: undefined,
    revalidate: vi.fn(),
  }),
}));

vi.mock('@/store/tfs/action', () => ({
  useTfsData: (query: { kind: string }) => ({
    data:
      query.kind === 'repositories'
        ? { repositories: { items: fixtures.repositories } }
        : undefined,
    error: undefined,
    isValidating: false,
    revalidate: vi.fn(),
  }),
}));

vi.mock('./useTfsPickerPages', () => ({
  useTfsPickerPages: (query: { kind: string }) => ({
    data: undefined,
    error: undefined,
    isValidating: false,
    items:
      query.kind === 'projects'
        ? [{ id: 'p1', name: 'Proj' }]
        : query.kind === 'branches'
          ? [{ name: 'release' }]
          : [],
    loadMore: vi.fn(),
    next: undefined,
    revalidate: vi.fn(),
    truncated: false,
  }),
}));

// The real Select and ActionIcon render through portals and hover tooltips;
// native controls let the test drive the picker's own behaviour.
vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof LobeUI>();
  return {
    ...actual,
    ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) => (
      <button title={title} type={'button'} onClick={onClick} />
    ),
    Select: ({
      'aria-label': ariaLabel,
      disabled,
      options = [],
      placeholder,
      value,
      onChange,
    }: {
      'aria-label'?: string;
      'disabled'?: boolean;
      'onChange'?: (value: string) => void;
      'options'?: { label: string; value: string }[];
      'placeholder'?: string;
      'value'?: string;
    }) => (
      <select
        aria-label={ariaLabel ?? placeholder}
        disabled={disabled}
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
      >
        <option value={''}>{placeholder ?? ''}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ),
  };
});

const choose = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

/** Multiple mode is controlled; this keeps the list between picks like a caller would. */
const MultipleHarness = ({
  max,
  onChange,
}: {
  max?: number;
  onChange?: (repositories: PickedRepository[]) => void;
}) => {
  const [value, setValue] = useState<PickedRepository[]>([]);
  return (
    <TfsRepositoryPicker
      multiple
      max={max}
      value={value}
      onClear={vi.fn()}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
};

afterEach(cleanup);

describe('TfsRepositoryPicker', () => {
  it('adds repositories with their own branches and reports each branch change', () => {
    const onChange = vi.fn();
    render(<MultipleHarness onChange={onChange} />);

    choose('tfs.project', 'Proj');
    choose('tfs.repository', 'repo-a');

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ defaultBranch: 'main', fullName: 'Proj/RepoA' }),
    ]);

    choose('tfs.repository', 'repo-b');

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ defaultBranch: 'main', fullName: 'Proj/RepoA' }),
      expect.objectContaining({ defaultBranch: 'develop', fullName: 'Proj/RepoB' }),
    ]);

    const branchSelects = screen.getAllByLabelText('tfs.branch');
    expect(branchSelects).toHaveLength(2);
    fireEvent.change(branchSelects[1], { target: { value: 'release' } });

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ defaultBranch: 'main', fullName: 'Proj/RepoA' }),
      expect.objectContaining({ defaultBranch: 'release', fullName: 'Proj/RepoB' }),
    ]);
  });

  it('never duplicates a repository and removes it', () => {
    const onChange = vi.fn();
    render(<MultipleHarness onChange={onChange} />);

    choose('tfs.project', 'Proj');
    choose('tfs.repository', 'repo-a');
    choose('tfs.repository', 'repo-b');
    choose('tfs.repository', 'repo-a');

    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(2);

    fireEvent.click(screen.getAllByTitle('tfs.removeRepository')[0]);

    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fullName: 'Proj/RepoB' }),
    ]);
  });

  it('stops adding at the repository limit', () => {
    const onChange = vi.fn();
    render(<MultipleHarness max={1} onChange={onChange} />);

    choose('tfs.project', 'Proj');
    choose('tfs.repository', 'repo-a');

    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(1);
    expect(screen.getByLabelText('tfs.repository')).toBeDisabled();
    expect(screen.getByText('tfs.maxRepositories')).toBeInTheDocument();
  });

  it('keeps the single-repository flow unchanged', () => {
    const onClear = vi.fn();
    const onSelect = vi.fn();
    render(<TfsRepositoryPicker onClear={onClear} onSelect={onSelect} />);

    choose('tfs.project', 'Proj');
    expect(onClear).toHaveBeenCalled();

    choose('tfs.repository', 'repo-a');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'repo-a' }));

    choose('tfs.branch', 'release');
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultBranch: 'release', id: 'repo-a' }),
    );
  });
});
