package expo.modules.nativeutil

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceIdentityFileStoreTest {
    @Test
    fun `creates and reuses an identity in the supplied no-backup path`() {
        val directory = Files.createTempDirectory("syncclipboard-device-id").toFile()
        val file = directory.resolve(DeviceIdentityFileStore.FILE_NAME)
        val first = "123e4567-e89b-42d3-a456-426614174000"
        val second = "00000000-0000-4000-8000-000000000000"

        assertEquals(first, DeviceIdentityFileStore.getOrCreate(file) { first })
        assertEquals(first, DeviceIdentityFileStore.getOrCreate(file) { second })

        directory.deleteRecursively()
    }

    @Test
    fun `replaces a malformed identity`() {
        val directory = Files.createTempDirectory("syncclipboard-device-id-invalid").toFile()
        val file = directory.resolve(DeviceIdentityFileStore.FILE_NAME)
        val replacement = "123e4567-e89b-42d3-a456-426614174000"
        file.writeText("restored-or-corrupt")

        assertEquals(replacement, DeviceIdentityFileStore.getOrCreate(file) { replacement })
        assertEquals(replacement, file.readText())

        directory.deleteRecursively()
    }
}
