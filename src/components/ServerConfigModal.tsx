/**
 * 服务器配置模态框
 * 用于添加或编辑服务器配置
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from 'react-i18next';
import { ServerConfig } from '@/types/api';
import { createClientFromConfig } from '@/services';

interface ServerConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (config: ServerConfig) => void;
  initialConfig?: ServerConfig;
  isEditing?: boolean;
}

export const ServerConfigModal: React.FC<ServerConfigModalProps> = ({
  visible,
  onClose,
  onSave,
  initialConfig,
  isEditing = false,
}) => {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [isTesting, setIsTesting] = useState(false);
  const testAbortControllerRef = useRef<AbortController | null>(null);

  const urlRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const [type, setType] = useState<'syncclipboard' | 'webdav' | 's3'>(
    initialConfig?.type || 'syncclipboard'
  );
  const [url, setUrl] = useState(initialConfig?.url || '');
  const [username, setUsername] = useState(initialConfig?.username || '');
  const [password, setPassword] = useState(initialConfig?.password || '');
  const [serverName, setServerName] = useState(initialConfig?.name || '');

  // S3 专有字段
  const [region, setRegion] = useState(initialConfig?.region || 'us-east-1');
  const [bucketName, setBucketName] = useState(initialConfig?.bucketName || '');
  const [objectPrefix, setObjectPrefix] = useState(initialConfig?.objectPrefix || '');
  const [forcePathStyle, setForcePathStyle] = useState(initialConfig?.forcePathStyle ?? false);

  const bucketNameRef = useRef<TextInput>(null);
  const regionRef = useRef<TextInput>(null);
  const objectPrefixRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible && initialConfig) {
      setType(initialConfig.type);
      setUrl(initialConfig.url);
      setUsername(initialConfig.username || '');
      setPassword(initialConfig.password || '');
      setServerName(initialConfig.name || '');
      setRegion(initialConfig.region || 'us-east-1');
      setBucketName(initialConfig.bucketName || '');
      setObjectPrefix(initialConfig.objectPrefix || '');
      setForcePathStyle(initialConfig.forcePathStyle ?? false);
    } else if (visible && !initialConfig) {
      setType('syncclipboard');
      setUrl('');
      setUsername('');
      setPassword('');
      setServerName('');
      setRegion('us-east-1');
      setBucketName('');
      setObjectPrefix('');
      setForcePathStyle(false);
    }
  }, [visible, initialConfig]);

  useEffect(() => {
    return () => {
      if (testAbortControllerRef.current) {
        testAbortControllerRef.current.abort();
        testAbortControllerRef.current = null;
      }
    };
  }, []);

  const handleClose = () => {
    if (testAbortControllerRef.current) {
      testAbortControllerRef.current.abort();
      testAbortControllerRef.current = null;
      setIsTesting(false);
    }
    onClose();
  };

  const validateForm = (): boolean => {
    if (type === 's3') {
      // S3：bucketName 必填，url 可选（AWS 原生时留空）
      if (!bucketName.trim()) {
        Alert.alert(t('server.errorTitle'), t('server.bucketNameRequired'));
        return false;
      }
      if (!username.trim()) {
        Alert.alert(t('server.errorTitle'), t('server.accessKeyRequired'));
        return false;
      }
      if (!password.trim()) {
        Alert.alert(t('server.errorTitle'), t('server.secretKeyRequired'));
        return false;
      }
      if (url.trim()) {
        try {
          new URL(url);
        } catch {
          Alert.alert(t('server.errorTitle'), t('server.endpointInvalid'));
          return false;
        }
      }
      return true;
    }

    if (!url.trim()) {
      Alert.alert(t('server.errorTitle'), t('server.urlRequired'));
      return false;
    }

    try {
      new URL(url);
    } catch {
      Alert.alert(t('server.errorTitle'), t('server.urlInvalid'));
      return false;
    }

    if (!username.trim()) {
      Alert.alert(t('server.errorTitle'), t('server.usernameRequired'));
      return false;
    }

    if (!password.trim()) {
      Alert.alert(t('server.errorTitle'), t('server.passwordRequired'));
      return false;
    }

    return true;
  };

  const handleTestConnection = async () => {
    if (isTesting && testAbortControllerRef.current) {
      testAbortControllerRef.current.abort();
      testAbortControllerRef.current = null;
      setIsTesting(false);
      return;
    }

    if (type === 's3') {
      if (!bucketName.trim() || !username.trim() || !password.trim()) {
        Alert.alert(t('server.tipTitle'), t('server.s3FieldsRequired'));
        return;
      }
    } else if (!url.trim() || !username.trim() || !password.trim()) {
      Alert.alert(t('server.tipTitle'), t('server.fieldsRequired'));
      return;
    }

    setIsTesting(true);
    testAbortControllerRef.current = new AbortController();

    try {
      const testConfig: ServerConfig = {
        type,
        url: url.trim(),
        username: username.trim(),
        password: password.trim(),
        ...(type === 's3' && {
          region: region.trim() || 'us-east-1',
          bucketName: bucketName.trim(),
          objectPrefix: objectPrefix.trim(),
          forcePathStyle,
        }),
      };

      console.log('[ServerConfigModal] Testing connection:', testConfig.url);
      const client = createClientFromConfig(testConfig);
      await client.testConnection(testAbortControllerRef.current.signal);
      console.log('[ServerConfigModal] Test succeeded');

      Alert.alert(t('server.testSuccessTitle'), t('server.testSuccess'));
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ServerConfigModal] Test cancelled');
        return;
      }
      console.error('[ServerConfigModal] Test failed:', error);
      Alert.alert(
        t('server.connectionFailedTitle'),
        error instanceof Error ? error.message : t('server.connectionFailed')
      );
    } finally {
      setIsTesting(false);
      testAbortControllerRef.current = null;
    }
  };

  const handleSave = () => {
    if (!validateForm()) {
      return;
    }

    const config: ServerConfig = {
      type,
      name: serverName.trim() || undefined,
      url: url.trim(),
      username: username.trim(),
      password: password.trim(),
      ...(type === 's3' && {
        region: region.trim() || 'us-east-1',
        bucketName: bucketName.trim(),
        objectPrefix: objectPrefix.trim(),
        forcePathStyle,
      }),
    };

    onSave(config);
    handleClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
            <TouchableOpacity onPress={handleClose} style={styles.headerButton}>
              <Text style={[styles.headerButtonText, { color: theme.colors.primary }]}>
                {t('common.cancel')}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
              {isEditing ? t('server.editTitle') : t('server.addTitle')}
            </Text>
            <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
              <Text
                style={[
                  styles.headerButtonText,
                  styles.headerButtonBold,
                  { color: theme.colors.primary },
                ]}
              >
                {t('common.save')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Form */}
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* 服务器类型 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                {t('server.typeSection')}
              </Text>
              <View
                style={[
                  styles.card,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    { borderBottomColor: theme.colors.divider },
                    type === 'syncclipboard' && {
                      backgroundColor: theme.colors.primary + '10',
                    },
                  ]}
                  onPress={() => setType('syncclipboard')}
                >
                  <View style={styles.typeContent}>
                    <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
                      {t('server.typeSyncClipboard')}
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      {t('server.typeSyncClipboardDesc')}
                    </Text>
                  </View>
                  {type === 'syncclipboard' && (
                    <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                      <Text style={[styles.checkmarkIcon, { color: theme.colors.white }]}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    { borderBottomColor: theme.colors.divider },
                    type === 'webdav' && { backgroundColor: theme.colors.primary + '10' },
                  ]}
                  onPress={() => setType('webdav')}
                >
                  <View style={styles.typeContent}>
                    <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
                      {t('server.typeWebDAV')}
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      {t('server.typeWebDAVDesc')}
                    </Text>
                  </View>
                  {type === 'webdav' && (
                    <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                      <Text style={[styles.checkmarkIcon, { color: theme.colors.white }]}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.typeOption,
                    type === 's3' && { backgroundColor: theme.colors.primary + '10' },
                  ]}
                  onPress={() => setType('s3')}
                >
                  <View style={styles.typeContent}>
                    <Text style={[styles.typeLabel, { color: theme.colors.text }]}>
                      {t('server.typeS3')}
                    </Text>
                    <Text style={[styles.typeDescription, { color: theme.colors.textSecondary }]}>
                      {t('server.typeS3Desc')}
                    </Text>
                  </View>
                  {type === 's3' && (
                    <View style={[styles.checkmark, { backgroundColor: theme.colors.primary }]}>
                      <Text style={[styles.checkmarkIcon, { color: theme.colors.white }]}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* 服务器信息 */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>
                {t('server.connectionSection')}
              </Text>
              <View
                style={[
                  styles.card,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider },
                ]}
              >
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                    {t('server.name')}
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        color: theme.colors.text,
                        backgroundColor: theme.colors.background,
                        borderColor: theme.colors.divider,
                      },
                    ]}
                    placeholder={t('server.namePlaceholder')}
                    placeholderTextColor={theme.colors.textTertiary}
                    value={serverName}
                    onChangeText={setServerName}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() =>
                      type === 's3' ? bucketNameRef.current?.focus() : urlRef.current?.focus()
                    }
                  />
                </View>

                {type === 's3' ? (
                  <>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        {t('server.bucketName')}
                      </Text>
                      <TextInput
                        ref={bucketNameRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder="my-bucket"
                        placeholderTextColor={theme.colors.textTertiary}
                        value={bucketName}
                        onChangeText={setBucketName}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => usernameRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Access Key ID *
                      </Text>
                      <TextInput
                        ref={usernameRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => passwordRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        Secret Access Key *
                      </Text>
                      <TextInput
                        ref={passwordRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => urlRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        {t('server.endpoint')}
                      </Text>
                      <TextInput
                        ref={urlRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder={t('server.endpointPlaceholder')}
                        placeholderTextColor={theme.colors.textTertiary}
                        value={url}
                        onChangeText={setUrl}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => regionRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        {t('server.region')}
                      </Text>
                      <TextInput
                        ref={regionRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder="us-east-1"
                        placeholderTextColor={theme.colors.textTertiary}
                        value={region}
                        onChangeText={setRegion}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => objectPrefixRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        {t('server.objectPrefix')}
                      </Text>
                      <TextInput
                        ref={objectPrefixRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder="syncclipboard"
                        placeholderTextColor={theme.colors.textTertiary}
                        value={objectPrefix}
                        onChangeText={setObjectPrefix}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={() => objectPrefixRef.current?.blur()}
                      />
                    </View>

                    <View style={styles.switchGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        {t('server.forcePathStyle')}
                      </Text>
                      <Switch
                        value={forcePathStyle}
                        onValueChange={setForcePathStyle}
                        trackColor={{ false: theme.colors.divider, true: theme.colors.primary }}
                        thumbColor={
                          forcePathStyle ? theme.colors.surface : theme.colors.textTertiary
                        }
                      />
                    </View>
                    <Text style={[styles.hintText, { color: theme.colors.textTertiary }]}>
                      {t('server.forcePathStyleHint')}
                    </Text>
                  </>
                ) : (
                  <>
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        {t('server.url')}
                      </Text>
                      <TextInput
                        ref={urlRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={url}
                        onChangeText={setUrl}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => usernameRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        {t('server.username')}
                      </Text>
                      <TextInput
                        ref={usernameRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                        submitBehavior="submit"
                        onSubmitEditing={() => passwordRef.current?.focus()}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: theme.colors.text }]}>
                        {t('server.password')}
                      </Text>
                      <TextInput
                        ref={passwordRef}
                        style={[
                          styles.input,
                          {
                            color: theme.colors.text,
                            backgroundColor: theme.colors.background,
                            borderColor: theme.colors.divider,
                          },
                        ]}
                        placeholder=""
                        placeholderTextColor={theme.colors.textTertiary}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="done"
                        onSubmitEditing={() => passwordRef.current?.blur()}
                      />
                    </View>
                  </>
                )}
              </View>
            </View>
          </ScrollView>

          <View
            style={[
              styles.footer,
              { backgroundColor: theme.colors.background, borderTopColor: theme.colors.divider },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.testButton,
                isTesting
                  ? {
                      backgroundColor: theme.colors.error + '20',
                      borderColor: theme.colors.error,
                    }
                  : {
                      backgroundColor: theme.colors.primary + '20',
                      borderColor: theme.colors.primary,
                    },
              ]}
              onPress={handleTestConnection}
            >
              {isTesting ? (
                <Text style={[styles.testButtonText, { color: theme.colors.error }]}>
                  {t('server.cancelTest')}
                </Text>
              ) : (
                <Text style={[styles.testButtonText, { color: theme.colors.primary }]}>
                  {t('server.testConnection')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 60,
  },
  headerButtonText: {
    fontSize: 17,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  typeOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  typeContent: {
    flex: 1,
  },
  typeLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  typeDescription: {
    fontSize: 13,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  checkmarkIcon: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  inputGroup: {
    marginBottom: 16,
  },
  switchGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  hintText: {
    fontSize: 12,
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  inputHint: {
    fontSize: 12,
    marginTop: 4,
  },
  testButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 8,
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerButtonBold: {
    fontWeight: '600',
  },
});
