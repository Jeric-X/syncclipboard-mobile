/**
 * Top Right Menu Component
 * 右上角菜单组件 - 用于首页和历史记录页面
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
  ActionSheetIOS,
} from 'react-native';
import { MoreVertical } from 'react-native-feather';
import { useTheme } from '@/hooks/useTheme';

export interface MenuItemConfig {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
  color?: string; // For text color
  destructive?: boolean; // Display as destructive action (red)
}

interface TopRightMenuProps {
  items: MenuItemConfig[];
  onClose?: () => void;
}

export const TopRightMenu: React.FC<TopRightMenuProps> = ({ items, onClose }) => {
  const { theme } = useTheme();
  const [showMenu, setShowMenu] = useState(false);
  const [menuTopOffset, setMenuTopOffset] = useState(60);
  const menuButtonRef = useRef<React.ComponentRef<typeof TouchableOpacity>>(null);

  const handleOpenMenu = useCallback(() => {
    if (Platform.OS === 'ios') {
      // iOS: Use ActionSheetIOS
      const options = ['取消', ...items.map((item) => item.label)];
      const cancelButtonIndex = 0;

      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          destructiveButtonIndex: items.findIndex((item) => item.destructive) + 1,
          tintColor: theme.colors.primary,
        },
        (buttonIndex) => {
          if (buttonIndex > 0 && buttonIndex <= items.length) {
            items[buttonIndex - 1].onPress();
            onClose?.();
          }
        }
      );
    } else {
      // Android: Use custom Modal menu
      if (menuButtonRef.current) {
        menuButtonRef.current.measure(
          (_x: number, _y: number, _w: number, h: number, _pageX: number, pageY: number) => {
            // 菜单出现在按钮下方，距离为按钮高度 + 4px
            setMenuTopOffset(pageY + h + 4);
            setShowMenu(true);
          }
        );
      } else {
        setShowMenu(true);
      }
    }
  }, [items, theme.colors.primary, onClose]);

  const handleMenuItemPress = (item: MenuItemConfig) => {
    item.onPress();
    setShowMenu(false);
    onClose?.();
  };

  const handleCloseMenu = () => {
    setShowMenu(false);
    onClose?.();
  };

  return (
    <>
      {/* Menu Button */}
      <TouchableOpacity
        ref={menuButtonRef}
        onPress={handleOpenMenu}
        style={styles.headerButton}
        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
      >
        <MoreVertical color={theme.colors.text} width={24} height={24} />
      </TouchableOpacity>

      {/* Android Custom Menu */}
      {Platform.OS === 'android' && (
        <Modal visible={showMenu} transparent animationType="none" onRequestClose={handleCloseMenu}>
          <Pressable style={styles.menuOverlay} onPress={handleCloseMenu}>
            <View
              style={[
                styles.floatingMenu,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.border,
                  top: menuTopOffset,
                },
              ]}
            >
              {items.map((item, index) => (
                <View key={index}>
                  <TouchableOpacity
                    style={styles.menuItem}
                    onPress={() => handleMenuItemPress(item)}
                  >
                    <Text
                      style={[
                        styles.menuItemText,
                        {
                          color:
                            item.color ||
                            (item.destructive
                              ? theme.colors.error || '#F44336'
                              : theme.colors.text),
                        },
                      ]}
                    >
                      {item.label}
                    </Text>
                    {item.icon && <View style={styles.menuItemIcon}>{item.icon}</View>}
                  </TouchableOpacity>
                  {index < items.length - 1 && (
                    <View style={[styles.menuDivider, { backgroundColor: theme.colors.border }]} />
                  )}
                </View>
              ))}
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuOverlay: {
    flex: 1,
  },
  floatingMenu: {
    position: 'absolute',
    right: 12,
    borderRadius: 8,
    minWidth: 180,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: '500',
  },
  menuItemIcon: {
    marginLeft: 8,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
  },
});
