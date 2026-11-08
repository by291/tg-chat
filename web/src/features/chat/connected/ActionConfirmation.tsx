import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import dialogs from '@/components/overlays/dialogs.module.css';
import overlays from '@/components/overlays/overlays.module.css';
import styles from './ConnectedChat.module.css';

export interface Confirmation {
  title: string;
  description: string;
  choices: Array<{ label: string; action: () => Promise<void> }>;
}

/** Require an explicit scope choice before a destructive chat command. */
export function ActionConfirmation(props: {
  confirmation?: Confirmation;
  isBusy: boolean;
  onCancel: () => void;
  onChoose: (action: () => Promise<void>) => void;
}) {
  return (
    <Dialog.Root
      open={Boolean(props.confirmation)}
      onOpenChange={(details) => {
        if (!details.open && !props.isBusy) {
          props.onCancel();
        }
      }}
      lazyMount
      unmountOnExit
    >
      <Portal>
        <Dialog.Backdrop className={dialogs.backdrop} />
        <Dialog.Positioner className={overlays.dialogPositioner}>
          <Dialog.Content className={`${styles.confirmation} ${dialogs.confirmation}`}>
            <Dialog.Title>{props.confirmation?.title}</Dialog.Title>
            <Dialog.Description>{props.confirmation?.description}</Dialog.Description>
            <div className={styles.actions}>
              <button type="button" disabled={props.isBusy} onClick={props.onCancel}>
                Cancel
              </button>
              {props.confirmation?.choices.map((choice) => (
                <button
                  type="button"
                  key={choice.label}
                  disabled={props.isBusy}
                  onClick={() => props.onChoose(choice.action)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
