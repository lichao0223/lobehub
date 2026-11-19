/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EnvironmentForm from './EnvironmentForm';

type PickerProps = {
  onClear: () => void;
  onSelect: (repository: { defaultBranch?: string; remoteUrl: string }) => void;
};

/**
 * Stands in for the TFS picker so the test drives its callbacks directly: the
 * real one needs a bound TFS account and paginated data.
 */
const picker = vi.hoisted(() => ({
  props: undefined as undefined | { onClear: () => void; onSelect: (repository: any) => void },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/Tfs/TfsRepositoryPicker', () => ({
  TfsRepositoryPicker: (props: PickerProps) => {
    picker.props = props;
    return (
      <div data-testid={'tfs-picker'}>
        <button onClick={() => props.onClear()}>clear-choice</button>
        <button
          onClick={() =>
            props.onSelect({ defaultBranch: 'main', remoteUrl: 'http://tfs/DefaultCollection/P/_git/R' })
          }
        >
          choose-repository
        </button>
      </div>
    );
  },
}));

afterEach(() => {
  cleanup();
  picker.props = undefined;
});

const openPicker = () => {
  render(<EnvironmentForm environment={{ configuration: {}, name: 'Env' }} onSave={vi.fn()} />);
  fireEvent.click(screen.getByText('environments.form.addTfsRepository'));
};

describe('environment TFS repository picker', () => {
  it('stays open when the chosen TFS project changes', () => {
    openPicker();

    // Changing project (or typing a repository URL) clears the previous
    // choice; it must not count as leaving the section.
    fireEvent.click(screen.getByText('clear-choice'));

    expect(picker.props).toBeDefined();
    expect(screen.queryByTestId('tfs-picker')).not.toBeNull();
  });

  it('closes once a repository is saved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EnvironmentForm environment={{ configuration: {}, name: 'Env' }} onSave={onSave} />);
    fireEvent.click(screen.getByText('environments.form.addTfsRepository'));

    fireEvent.click(screen.getByText('choose-repository'));

    expect(screen.queryByTestId('tfs-picker')).toBeNull();
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        configuration: {
          sources: [
            {
              kind: 'git',
              ref: 'main',
              url: 'http://tfs/DefaultCollection/P/_git/R',
            },
          ],
        },
      }),
    );
  });
});
