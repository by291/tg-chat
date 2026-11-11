import { CircleCheck, Eye, ListChecks, Plus, Repeat2, Shuffle, Timer } from 'lucide-react';
import { ListSetting } from './ListDialogFields';
import { FormReveal } from './FormReveal';
import { PollTextField } from './PollTextField';
import {
  changePollSetting,
  KEEP_POLL_DEADLINE,
  MAX_EXPLANATION_LENGTH,
  type PollSettings,
} from './listComposition';
import styles from './ComposerListDialog.module.css';

const DURATION_CHOICES = [
  { hours: 1, label: '1 hour' },
  { hours: 3, label: '3 hours' },
  { hours: 8, label: '8 hours' },
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
];

const SETTINGS = [
  {
    name: 'shouldShowVoters',
    title: 'Show Who Voted',
    description: 'Display who voted for each option',
    Icon: Eye,
    color: '#efa740',
  },
  {
    name: 'canChooseMultiple',
    title: 'Allow Multiple Answers',
    description: 'Voters can select more than one option',
    Icon: ListChecks,
    color: '#579fea',
  },
  {
    name: 'canAddOptions',
    title: 'Allow Adding Options',
    description: 'Participants can suggest new options',
    Icon: Plus,
    color: '#72b764',
  },
  {
    name: 'canRevote',
    title: 'Allow Revoting',
    description: 'Voters can change their answers',
    Icon: Repeat2,
    color: '#e65487',
  },
  {
    name: 'shouldShuffleOptions',
    title: 'Shuffle Options',
    description: 'Answers appear in random order for each voter',
    Icon: Shuffle,
    color: '#efa740',
  },
  {
    name: 'hasCorrectAnswer',
    title: 'Set Correct Answer',
    description: 'Mark one or more options as the correct answer',
    Icon: CircleCheck,
    color: '#67b564',
  },
  {
    name: 'hasTimeLimit',
    title: 'Limit Duration',
    description: 'Automatically close the poll after a certain time',
    Icon: Timer,
    color: '#579fea',
  },
] as const;

/** Present poll settings and reveal dependent fields without discarding their drafts. */
export function PollSettingsFields({
  settings,
  onChange,
  explanation,
  onExplanationChange,
  isPollAnonymousOnly,
  isConnected,
  previousDeadline,
}: {
  settings: PollSettings;
  onChange: (settings: PollSettings) => void;
  explanation: string;
  onExplanationChange: (value: string) => void;
  isPollAnonymousOnly?: boolean;
  isConnected?: boolean;
  previousDeadline?: number;
}) {
  return (
    <section className={styles.section}>
      <h3>Settings</h3>
      {SETTINGS.map(({ name, title, description, Icon, color }) => {
        if (name === 'shouldShuffleOptions' && isConnected) {
          return null;
        }

        const isAddingDisabled =
          name === 'canAddOptions' && (!settings.shouldShowVoters || settings.hasCorrectAnswer);
        const isPublicDisabled = name === 'shouldShowVoters' && isPollAnonymousOnly;
        const isRevoteDisabled = name === 'canRevote' && settings.hasCorrectAnswer;

        return (
          <ListSetting
            key={name}
            title={title}
            description={description}
            icon={<Icon size={24} />}
            color={color}
            isChecked={settings[name]}
            isDisabled={isAddingDisabled || isPublicDisabled || isRevoteDisabled}
            onChange={({ isChecked }) =>
              onChange(
                changePollSetting({
                  settings,
                  name,
                  isEnabled: isChecked,
                }),
              )
            }
          />
        );
      })}
      <FormReveal isOpen={settings.hasTimeLimit}>
        <div>
          <label className={styles.duration}>
            Poll Duration
            <select
              value={settings.durationHours}
              onChange={(event) => {
                onChange({ ...settings, durationHours: Number(event.target.value) });
              }}
              tabIndex={settings.hasTimeLimit ? 0 : -1}
            >
              {previousDeadline !== undefined && (
                <option value={KEEP_POLL_DEADLINE}>Keep current deadline</option>
              )}
              {DURATION_CHOICES.map((choice) => (
                <option key={choice.hours} value={choice.hours}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </FormReveal>
      {(isConnected || settings.hasTimeLimit) && (
        <ListSetting
          title="Hide Results"
          description="Show results only after the poll closes"
          isChecked={settings.shouldHideResults}
          onChange={({ isChecked }) => onChange({ ...settings, shouldHideResults: isChecked })}
        />
      )}
      <FormReveal isOpen={settings.hasCorrectAnswer}>
        <div>
          <PollTextField
            className={styles.explanationField}
            label="Explanation (optional)"
            value={explanation}
            maxLength={MAX_EXPLANATION_LENGTH}
            isMultiline
            onChange={onExplanationChange}
          />
        </div>
      </FormReveal>
    </section>
  );
}
