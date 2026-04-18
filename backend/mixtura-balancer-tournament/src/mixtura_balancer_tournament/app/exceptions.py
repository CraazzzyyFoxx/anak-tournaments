class DomainException(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


class InternalLogicException(DomainException):
    def __init__(self, message: str):
        super().__init__(status_code=500, message=message)


class BadRequestException(DomainException):
    def __init__(self, message: str):
        super().__init__(status_code=400, message=message)
