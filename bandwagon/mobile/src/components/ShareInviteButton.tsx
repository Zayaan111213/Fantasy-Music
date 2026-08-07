import { Share, Pressable, Text } from 'react-native';
import { Share2 } from 'lucide-react-native';
import { posthog } from '../lib/posthog';

interface Props {
  leagueName: string;
  inviteUrl: string;
  className?: string;
  variant?: 'primary' | 'secondary';
}

// The web version falls back to a custom share-sheet modal when
// navigator.share isn't available (desktop browsers). RN's Share API always
// opens the native OS share sheet, so no fallback is needed.
export function ShareInviteButton({ leagueName, inviteUrl, className = '', variant = 'secondary' }: Props) {
  async function handleShare() {
    const result = await Share.share({
      message: `Join my league "${leagueName}" on Bandwagoner! ${inviteUrl}`,
      url: inviteUrl,
    });
    // The web fires this with method 'native' | 'fallback_modal' | 'copy_link'.
    // RN only ever opens the OS sheet, but unlike navigator.share it tells us
    // whether the sheet was actually used, so a dismissal isn't logged as a share.
    if (result.action === 'sharedAction') posthog.capture('invite_shared', { method: 'native' });
  }

  return (
    <Pressable
      onPress={handleShare}
      className={`flex-row items-center justify-center gap-2 rounded-lg px-4 py-2.5 ${variant === 'primary' ? 'bg-indigo-500' : 'bg-white/10 border border-white/20'} ${className}`}
    >
      <Share2 color={variant === 'primary' ? '#140D09' : '#F3E7CE'} size={16} />
      <Text className={`font-medium text-sm ${variant === 'primary' ? 'text-gray-950' : 'text-white'}`}>Share</Text>
    </Pressable>
  );
}
