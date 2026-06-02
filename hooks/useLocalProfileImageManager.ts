import { useCallback, useState } from 'react';

import { useAppToast } from '@/components/ui/AppToast';
import {
  deleteAllManagedProfileImages,
  deleteManagedProfileImage,
  pickAndPersistLocalProfileImage,
  pruneManagedProfileImages,
} from '@/lib/profile/profile-image';
import { useAppStore } from '@/store/app';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Try a different image.';
}

export function useLocalProfileImageManager(): {
  profileImageUri: string | null;
  pickingProfileImage: boolean;
  pickProfileImage: () => Promise<void>;
  clearProfileImage: () => Promise<void>;
} {
  const { showToast } = useAppToast();
  const profileImageUri = useAppStore((state) => state.profileImageUri);
  const setProfileImageUri = useAppStore((state) => state.setProfileImageUri);
  const [pickingProfileImage, setPickingProfileImage] = useState(false);

  const pickProfileImage = useCallback(async (): Promise<void> => {
    if (pickingProfileImage) return;

    setPickingProfileImage(true);
    try {
      const nextProfileImageUri = await pickAndPersistLocalProfileImage();
      if (nextProfileImageUri == null) return;

      const previousProfileImageUri = useAppStore.getState().profileImageUri;
      setProfileImageUri(nextProfileImageUri);
      deleteManagedProfileImage(previousProfileImageUri);
      pruneManagedProfileImages(nextProfileImageUri);
      showToast({
        title: 'Profile photo updated',
        variant: 'success',
      });
    } catch (error) {
      showToast({
        title: 'Photo update failed',
        message: getErrorMessage(error),
        variant: 'error',
      });
    } finally {
      setPickingProfileImage(false);
    }
  }, [pickingProfileImage, setProfileImageUri, showToast]);

  const clearProfileImage = useCallback(async (): Promise<void> => {
    const previousProfileImageUri = useAppStore.getState().profileImageUri;
    if (previousProfileImageUri == null) {
      deleteAllManagedProfileImages();
      return;
    }

    setProfileImageUri(null);
    deleteAllManagedProfileImages();
    showToast({
      title: 'Profile photo reset',
      variant: 'info',
    });
  }, [setProfileImageUri, showToast]);

  return {
    profileImageUri,
    pickingProfileImage,
    pickProfileImage,
    clearProfileImage,
  };
}
