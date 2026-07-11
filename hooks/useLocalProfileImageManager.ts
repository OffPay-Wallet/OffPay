import { useRef, useState } from 'react';

import { useAppToast } from '@/components/ui/AppToast';
import {
  deleteAllManagedProfileImages,
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
  const mutationLockRef = useRef(false);

  const pickProfileImage = async (): Promise<void> => {
    if (mutationLockRef.current) return;

    mutationLockRef.current = true;
    setPickingProfileImage(true);
    try {
      const nextProfileImageUri = await pickAndPersistLocalProfileImage();
      if (nextProfileImageUri == null) return;

      setProfileImageUri(nextProfileImageUri);
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
      mutationLockRef.current = false;
      setPickingProfileImage(false);
    }
  };

  const clearProfileImage = async (): Promise<void> => {
    if (mutationLockRef.current) return;

    mutationLockRef.current = true;
    try {
      if (useAppStore.getState().profileImageUri == null) {
        deleteAllManagedProfileImages();
        return;
      }

      setProfileImageUri(null);
      deleteAllManagedProfileImages();
      showToast({
        title: 'Profile photo reset',
        variant: 'info',
      });
    } finally {
      mutationLockRef.current = false;
    }
  };

  return {
    profileImageUri,
    pickingProfileImage,
    pickProfileImage,
    clearProfileImage,
  };
}
