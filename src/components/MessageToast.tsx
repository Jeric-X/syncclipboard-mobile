/**
 * Message Toast Component
 * 自动关闭的条幅提示组件
 */

import React, { useRef } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

export type MessageType = 'success' | 'error' | 'info';

interface Message {
  text: string;
  type: MessageType;
}

interface MessageToastProps {
  message: Message | null;
  onMessageShown: () => void;
}

export function MessageToast({ message, onMessageShown }: MessageToastProps) {
  const { theme } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (message) {
      // 淡入动画
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(2500),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        onMessageShown();
      });
    }
  }, [message, fadeAnim, onMessageShown]);

  if (!message) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.messageContainer,
        message.type === 'success' && { backgroundColor: theme.colors.messageSuccess },
        message.type === 'error' && { backgroundColor: theme.colors.messageError },
        message.type === 'info' && { backgroundColor: theme.colors.primary },
        { opacity: fadeAnim },
      ]}
    >
      <Text style={[styles.messageText, { color: theme.colors.white }]}>{message.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  messageContainer: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  messageText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
