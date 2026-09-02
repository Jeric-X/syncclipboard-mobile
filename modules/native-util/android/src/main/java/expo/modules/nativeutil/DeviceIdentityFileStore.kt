package expo.modules.nativeutil

import java.io.File
import java.util.UUID

/** Persists the installation identity below Android's no-backup directory. */
internal object DeviceIdentityFileStore {
    const val FILE_NAME = "sync_device_id"
    private val uuidPattern = Regex(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )

    @Synchronized
    fun getOrCreate(
        file: File,
        generate: () -> String = { UUID.randomUUID().toString() }
    ): String {
        val existing = runCatching { file.readText().trim() }.getOrNull()
        if (existing != null && uuidPattern.matches(existing)) return existing

        val generated = generate()
        require(uuidPattern.matches(generated)) { "Device identity generator returned an invalid UUID" }
        file.parentFile?.mkdirs()
        val temporary = File(file.parentFile, "${file.name}.tmp")
        temporary.writeText(generated)
        if (!temporary.renameTo(file)) {
            file.writeText(generated)
            temporary.delete()
        }
        return generated
    }
}
