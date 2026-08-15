import React, { useRef, useState } from 'react';
import {
  Animated,
  Easing,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Check, ChevronDown, X } from 'react-native-feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks/useTheme';
import type { ServerConfig } from '@/types/api';

interface ServerSelectProps {
  servers: ServerConfig[];
  selectedServerId?: string;
  onSelect: (serverId: string) => void;
  hasError?: boolean;
  testID?: string;
}

const serverLabel = (server: ServerConfig) => server.name || server.url;

export const ServerSelect = ({
  servers,
  selectedServerId,
  onSelect,
  hasError = false,
  testID = 'server-select',
}: ServerSelectProps) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const sheetTranslateY = useRef(new Animated.Value(screenHeight)).current;
  const sheetHeight = useRef(0);
  const opening = useRef(false);
  const closing = useRef(false);
  const pendingOnClosed = useRef<(() => void) | null>(null);
  const selectedServer = servers.find((server) => server.id === selectedServerId);

  const openModal = () => {
    closing.current = false;
    opening.current = true;
    pendingOnClosed.current = null;
    sheetTranslateY.stopAnimation();
    sheetTranslateY.setValue(sheetHeight.current || screenHeight);
    setVisible(true);
  };

  const animateOpen = () => {
    if (!opening.current || sheetHeight.current <= 0) return;
    opening.current = false;
    sheetTranslateY.stopAnimation();
    sheetTranslateY.setValue(sheetHeight.current);
    Animated.timing(sheetTranslateY, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const handleSheetLayout = (event: LayoutChangeEvent) => {
    sheetHeight.current = event.nativeEvent.layout.height;
    animateOpen();
  };

  const animateClose = (onClosed?: () => void) => {
    if (!visible || closing.current) return;
    opening.current = false;
    closing.current = true;
    pendingOnClosed.current = onClosed ?? null;
    sheetTranslateY.stopAnimation();
    Animated.timing(sheetTranslateY, {
      toValue: sheetHeight.current || screenHeight,
      duration: 260,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      closing.current = false;
      if (!finished) {
        pendingOnClosed.current = null;
        return;
      }
      setVisible(false);
      const callback = pendingOnClosed.current;
      pendingOnClosed.current = null;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          callback?.();
        });
      });
    });
  };

  const closeModal = () => animateClose();

  const selectServer = (serverId: string) => {
    animateClose(() => onSelect(serverId));
  };

  return (
    <>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('networkAutoSwitch.selectServer')}
        disabled={servers.length === 0}
        style={[
          styles.field,
          {
            backgroundColor: theme.colors.background,
            borderColor: hasError ? theme.colors.error : theme.colors.divider,
          },
          servers.length === 0 && styles.disabled,
        ]}
        onPress={openModal}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.fieldText,
            { color: selectedServer ? theme.colors.text : theme.colors.textTertiary },
          ]}
        >
          {selectedServer
            ? serverLabel(selectedServer)
            : t('networkAutoSwitch.selectServerPlaceholder')}
        </Text>
        <ChevronDown color={theme.colors.textSecondary} width={20} height={20} />
      </TouchableOpacity>

      <Modal
        visible={visible}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="none"
        hardwareAccelerated
        onShow={animateOpen}
        onRequestClose={closeModal}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
            onPress={closeModal}
          />
          <Animated.View
            onLayout={handleSheetLayout}
            renderToHardwareTextureAndroid
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surface,
                paddingBottom: Math.max(insets.bottom, 16),
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: theme.colors.divider }]} />
            <View style={styles.header}>
              <Text style={[styles.title, { color: theme.colors.text }]}>
                {t('networkAutoSwitch.selectServer')}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                style={[styles.closeButton, { backgroundColor: theme.colors.background }]}
                onPress={closeModal}
              >
                <X color={theme.colors.textSecondary} width={20} height={20} />
              </TouchableOpacity>
            </View>
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.options}
            >
              {servers.map((server) => {
                if (!server.id) return null;
                const selected = server.id === selectedServerId;
                return (
                  <TouchableOpacity
                    key={server.id}
                    testID={`${testID}-option-${server.id}`}
                    accessibilityRole="radio"
                    accessibilityLabel={serverLabel(server)}
                    accessibilityState={{ checked: selected }}
                    style={[
                      styles.option,
                      {
                        backgroundColor: selected
                          ? `${theme.colors.primary}14`
                          : theme.colors.surface,
                      },
                    ]}
                    onPress={() => selectServer(server.id!)}
                  >
                    <View style={styles.optionText}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.optionName,
                          { color: selected ? theme.colors.primary : theme.colors.text },
                        ]}
                      >
                        {serverLabel(server)}
                      </Text>
                      {!!server.name && (
                        <Text
                          numberOfLines={1}
                          style={[styles.optionUrl, { color: theme.colors.textTertiary }]}
                        >
                          {server.url}
                        </Text>
                      )}
                    </View>
                    <View
                      style={[
                        styles.selection,
                        {
                          borderColor: selected ? theme.colors.primary : theme.colors.divider,
                          backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
                        },
                      ]}
                    >
                      {selected && <Check color={theme.colors.white} width={15} height={15} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  field: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldText: { flex: 1, fontSize: 15 },
  disabled: { opacity: 0.55 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
  },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginVertical: 4 },
  header: {
    minHeight: 60,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: { flex: 1, fontSize: 18, fontWeight: '700' },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: { paddingHorizontal: 12, paddingBottom: 4, gap: 4 },
  option: {
    minHeight: 60,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionText: { flex: 1 },
  optionName: { fontSize: 15, fontWeight: '600' },
  optionUrl: { fontSize: 12, marginTop: 3 },
  selection: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
