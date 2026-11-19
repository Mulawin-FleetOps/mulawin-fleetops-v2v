<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class MultipartInputTest extends TestCase {
    private array $server;
    private array $post;

    protected function setUp(): void {
        $this->server = $_SERVER;
        $this->post = $_POST;
        $_SERVER['CONTENT_TYPE'] = 'multipart/form-data; boundary=test';
        $_SERVER['CONTENT_LENGTH'] = '100';
        $_POST = [];
    }

    protected function tearDown(): void {
        $_SERVER = $this->server;
        $_POST = $this->post;
    }

    public function testOversizedUploadReportsSizeInsteadOfMissingCompanyName(): void {
        if ((float)ini_get('post_max_size') <= 0) self::markTestSkipped('Requires a finite POST limit.');
        $_SERVER['CONTENT_LENGTH'] = (string)PHP_INT_MAX;
        try {
            inputData();
            self::fail('Oversized upload was accepted.');
        } catch (BusinessRuleException $e) {
            self::assertSame(413, $e->httpStatus);
            self::assertStringContainsString('upload limit', $e->getMessage());
        }
    }

    public function testMissingMultipartPayloadIsRejected(): void {
        $this->expectException(BusinessRuleException::class);
        $this->expectExceptionMessage('form data was not received');
        inputData();
    }

    public function testCompanyNameSurvivesValidMultipartPayload(): void {
        $_POST['payload'] = json_encode(['company_name' => 'Example Company']);
        self::assertSame(['company_name' => 'Example Company'], inputData());
    }
}
